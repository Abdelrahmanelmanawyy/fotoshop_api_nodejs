import { Router } from "express";
import { initializeFirebase } from "../../config/firebase.js";
import { orderService } from "../../composition/container.js";
import { sanitizeCollectionName, sanitizeOrderId } from "../../core/validation.js";

const router = Router();

router.use((req, res, next) => {
  try {
    initializeFirebase();
    next();
  } catch (err) {
    res.status(500).json({ error: "Firebase initialization failed", message: err.message });
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

    const result = await orderService.processOrder(orderId, collection);
    console.log(`[API] Order ${orderId} completed:`, result.results?.length, "photos processed");

    res.json(result);
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

    const result = await orderService.processOrder(orderId, collection);
    console.log(`[API] Order ${orderId} completed:`, result.results?.length, "photos processed");

    res.json(result);
  } catch (err) {
    console.error("Process order error:", err);
    res.status(500).json({
      error: "Failed to process order",
      message: err.message,
    });
  }
});

export default router;
