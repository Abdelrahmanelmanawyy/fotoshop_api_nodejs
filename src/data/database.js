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
