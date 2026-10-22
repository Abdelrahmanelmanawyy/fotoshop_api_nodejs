import { Router } from "express";
import { orderService } from "../../composition/container.js";
import { sanitizeCollectionName, sanitizeOrderId } from "../../core/validation.js";
import * as database from "../../data/database.js";
import { isOpenAiDirectModel, verifyOpenAiAuth } from "../../data/openaiImage.js";
import { verifyReplicateAuth } from "../../data/replicate.js";
import { recordSpend } from "../../domain/spendGuard.js";

const TERMINAL_STATUSES = new Set(["completed", "refunded"]);

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
      if (result.skipped) {
        console.log(`[API] Order ${orderId} not processed (async): ${result.skipped}`);
        return;
      }
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

/**
 * Shared handler for both route shapes. Cheap checks run here so the caller gets
 * a meaningful status; processOrder repeats the payment check and does the atomic
 * claim, so racing triggers still cannot double-process.
 */
async function acceptOrder(req, res, rawOrderId) {
  try {
    const orderId = sanitizeOrderId(rawOrderId);
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
    const { order } = providers;

    const owns = checkOwnership(order, req);
    if (!owns.ok) {
      return res.status(owns.status).json({ error: owns.error, message: owns.message });
    }

    if (TERMINAL_STATUSES.has(order.status)) {
      return res.status(409).json({ error: "order_already_finished", status: order.status });
    }

    if (!(await database.isOrderPaid(orderId))) {
      return res.status(402).json({ error: "order_not_paid" });
    }

    recordSpend((order.photos ?? []).length || 1);
    processInBackground(orderId, collection);
    return res.status(202).json({ accepted: true, order_id: orderId });
  } catch (err) {
    console.error("[API] Process order error:", err);
    return res.status(500).json({ error: "process_order_failed" });
  }
}

const router = Router();

/** POST /process/order — Body: { order_id, collection?: "orders" } */
router.post("/order", (req, res) => acceptOrder(req, res, req.body?.order_id));

/** POST /process/order/:orderId */
router.post("/order/:orderId", (req, res) => acceptOrder(req, res, req.params?.orderId));

export default router;
