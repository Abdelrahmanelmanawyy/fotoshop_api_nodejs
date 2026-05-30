import { Router } from "express";
import { getSupabase } from "../../config/supabase.js";
import { orderService } from "../../composition/container.js";
import { sanitizeCollectionName, sanitizeOrderId } from "../../core/validation.js";
import * as database from "../../data/database.js";
import { isOpenAiDirectModel, verifyOpenAiAuth } from "../../data/openaiImage.js";
import { verifyReplicateAuth } from "../../data/replicate.js";

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

  return { ok: true };
}

function summarizeOrderResults(result) {
  const results = result.results ?? [];
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return { results, succeeded, failed, total: results.length };
}

async function respondWithOrderResult(res, orderId, result) {
  const { succeeded, failed, total } = summarizeOrderResults(result);

  if (succeeded === 0 && total > 0) {
    const firstError = result.results.find((r) => !r.success)?.error ?? "All photos failed";
    console.error(`[API] Order ${orderId} failed: 0/${total} photos succeeded`);
    return res.status(502).json({
      error: "order_processing_failed",
      message: firstError,
      order_id: orderId,
      ...result,
    });
  }

  console.log(`[API] Order ${orderId} completed: ${succeeded}/${total} photos succeeded`);
  return res.json(result);
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

    const result = await orderService.processOrder(orderId, collection);
    return respondWithOrderResult(res, orderId, result);
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

    const result = await orderService.processOrder(orderId, collection);
    return respondWithOrderResult(res, orderId, result);
  } catch (err) {
    console.error("Process order error:", err);
    res.status(500).json({
      error: "Failed to process order",
      message: err.message,
    });
  }
});

export default router;
