import { getSupabase } from "../config/supabase.js";

/**
 * Get order row from Supabase.
 */
export async function getOrder(orderId, tableName = "orders") {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(`Database read failed: ${error.message}`);
  return data;
}

/**
 * Update the output_url of a specific photo inside the orders.photos JSONB array.
 */
export async function updatePhotoOutput(
  orderId,
  photoId,
  outputUrl,
  tableName = "orders"
) {
  const supabase = getSupabase();

  // Read current photos array
  const { data: order, error: readErr } = await supabase
    .from(tableName)
    .select("photos")
    .eq("id", orderId)
    .single();

  if (readErr) throw new Error(`Order ${orderId} not found: ${readErr.message}`);

  const photos = order.photos ?? [];
  const photoIndex = photos.findIndex((p) => p.photo_id === photoId);

  if (photoIndex === -1) {
    throw new Error(`Photo ${photoId} not found in order ${orderId}`);
  }

  photos[photoIndex].output_url = outputUrl;
  photos[photoIndex].output_completed_at = new Date().toISOString();

  const { error: writeErr } = await supabase
    .from(tableName)
    .update({ photos })
    .eq("id", orderId);

  if (writeErr) throw new Error(`Database update failed: ${writeErr.message}`);
}

/**
 * Set an order's lifecycle status (pending|processing|completed|failed|refunded).
 * Uses the SECURITY DEFINER RPC set_order_status (also bumps attempts on
 * 'processing'). Best-effort: a status write must never mask the real result.
 */
export async function setOrderStatus(orderId, status, errorText = null) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("set_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_error: errorText,
  });
  if (error) {
    console.error(`[DB] set_order_status(${orderId}, ${status}) failed: ${error.message}`);
  }
}

/**
 * Find AI orders that look stuck: still 'pending' past the pending grace
 * (the fire-and-forget trigger likely never reached the backend) or 'processing'
 * past the processing grace (the worker crashed / hung mid-job). Newest grace
 * windows passed in ms. AI-only — biometric reconciliation is handled separately.
 */
export async function getStuckOrders({ pendingGraceMs, processingGraceMs, limit = 20 }) {
  const supabase = getSupabase();
  const pendingCutoff = new Date(Date.now() - pendingGraceMs).toISOString();
  const processingCutoff = new Date(Date.now() - processingGraceMs).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("id, status, attempts, created_at, kind, photos, credits_spent")
    .eq("kind", "ai")
    .or(
      `and(status.eq.pending,created_at.lt.${pendingCutoff}),` +
      `and(status.eq.processing,created_at.lt.${processingCutoff})`
    )
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`getStuckOrders failed: ${error.message}`);
  return data ?? [];
}

/**
 * Refund the credits charged for an order, exactly once (idempotent in SQL).
 * Sets the order to 'refunded'. Returns true on success.
 */
export async function refundOrder(orderId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("refund_order_credits", {
    p_order_id: orderId,
  });
  if (error) {
    console.error(`[DB] refund_order_credits(${orderId}) failed: ${error.message}`);
    return false;
  }
  console.log(`[DB] Refunded order ${orderId}`);
  return true;
}
