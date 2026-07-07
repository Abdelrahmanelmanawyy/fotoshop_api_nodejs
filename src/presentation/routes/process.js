import { Router } from "express";
import { getSupabase } from "../../config/supabase.js";
import { orderService } from "../../composition/container.js";
import { sanitizeCollectionName, sanitizeOrderId } from "../../core/validation.js";
import * as database from "../../data/database.js";
import { isOpenAiDirectModel, verifyOpenAiAuth } from "../../data/openaiImage.js";
import { verifyReplicateAuth } from "../../data/replicate.js";
import { recordSpend } from "../../domain/spendGuard.js";

async function verifyOrderProviders(orderId, collection) {
  const order = await database.getOrder(orderId, collection);
  if (!order) {
    return {
      ok: false,
      status: 404,
      error: "order_not_found",
      message: `Order not found: ${orderId}`,
    };
  }

  const photos = order.photos ?? [];
  const needsReplicate = photos.some(
    (p) => !isOpenAiDirectModel(p.replicate_model)
  );
  const needsOpenAi = photos.some((p) => isOpenAiDirectModel(p.replicate_model));

  if (needsReplicate) {
    const replicate = await verifyReplicateAuth();
    if (!replicate.ok) {
      return {
        ok: false,
        status: 503,
        error: "replicate_not_configured",
        message: replicate.message,
      };
    }
  }

  if (needsOpenAi) {
    const openai = verifyOpenAiAuth();
    if (!openai.ok) {
      return {
        ok: false,
        status: 503,
        error: "openai_not_configured",
        message: openai.message,
      };
    }
  }

  return { ok: true, order };
}

/**
 * Enforce that the authenticated caller owns the order. In soft auth mode
 * (no req.user) this is a no-op; once REQUIRE_AUTH=1 it blocks A-triggers-B.
 */
function checkOwnership(order, req) {
  if (req.user && order?.user_id && order.user_id !== req.user.id) {
    return { ok: false, status: 403, error: "forbidden", message: "Not your order" };
  }
  return { ok: true };
}

/**
 * Kick off processing WITHOUT holding the HTTP request open (PLAN §5.2).
 * Generation takes seconds-to-minutes; keeping the socket open that long
 * caused proxy 502s and tied up the HTTP tier. The client never reads this
 * response anyway — it watches the order row via Supabase realtime, and the
 * sweeper re-processes/refunds if this process dies mid-job.
 */
function processInBackground(orderId, collection) {
  orderService.processOrder(orderId, collection).then(
    (result) => {
      const results = result.results ?? [];
      const succeeded = results.filter((r) => r.success).length;
      console.log(`[API] Order ${orderId} finished (async): ${succeeded}/${results.length} ok`);
    },
    (err) => {
      // processOrder already refunds/updates status on internal failures; this
      // catches fetch-order errors etc. The sweeper is the safety net.
      console.error(`[API] Async processing error for ${orderId}:`, err?.message ?? err);
    }
  );
}

const router = Router();

router.use((req, res, next) => {
  try {
    getSupabase();
    next();
  } catch (err) {
    res.status(500).json({ error: "Supabase initialization failed", message: err.message });
  }
});

/**
 * POST /process/order
 * Body: { order_id, collection?: "orders" }
 */
router.post("/order", async (req, res) => {
  try {
    const orderId = sanitizeOrderId(req.body?.order_id);
    const collection = sanitizeCollectionName(req.body?.collection);
    console.log(`[API] POST /process/order received, order_id=${orderId}`);

    if (!orderId) {
      return res.status(400).json({
        error: "order_id is required",
        message: "order_id must be a non-empty string (allowed: letters, numbers, underscore, hyphen)",
      });
    }

    const providers = await verifyOrderProviders(orderId, collection);
    if (!providers.ok) {
      return res.status(providers.status).json({
        error: providers.error,
        message: providers.message,
      });
    }

    const owns = checkOwnership(providers.order, req);
    if (!owns.ok) {
      return res.status(owns.status).json({ error: owns.error, message: owns.message });
    }

    recordSpend((providers.order.photos ?? []).length || 1);
    processInBackground(orderId, collection);
    return res.status(202).json({ accepted: true, order_id: orderId });
  } catch (err) {
    console.error("Process order error:", err);
    res.status(500).json({
      error: "Failed to process order",
      message: err.message,
    });
  }
});

/**
 * POST /process/order/:orderId
 */
router.post("/order/:orderId", async (req, res) => {
  try {
    const orderId = sanitizeOrderId(req.params?.orderId);
    const collection = sanitizeCollectionName(req.body?.collection);
    console.log(`[API] POST /process/order/${orderId} received`);

    if (!orderId) {
      return res.status(400).json({
        error: "Invalid orderId",
        message: "orderId must match allowed pattern",
      });
    }

    const providers = await verifyOrderProviders(orderId, collection);
    if (!providers.ok) {
      return res.status(providers.status).json({
        error: providers.error,
        message: providers.message,
      });
    }

    const owns = checkOwnership(providers.order, req);
    if (!owns.ok) {
      return res.status(owns.status).json({ error: owns.error, message: owns.message });
    }

    recordSpend((providers.order.photos ?? []).length || 1);
    processInBackground(orderId, collection);
    return res.status(202).json({ accepted: true, order_id: orderId });
  } catch (err) {
    console.error("Process order error:", err);
    res.status(500).json({
      error: "Failed to process order",
      message: err.message,
    });
  }
});

export default router;
