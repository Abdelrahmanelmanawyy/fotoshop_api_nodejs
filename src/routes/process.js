import { Router } from "express";
import { processOrder } from "../services/processor.js";
import { initializeFirebase } from "../config/firebase.js";

const router = Router();

// Ensure Firebase is initialized before processing
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
 * Body: { order_id: "ORD_1770598001221", collection?: "orders" }
 *
 * Processes all photos in the order:
 * - Fetches order from Firestore
 * - For each photo: sends to Replicate, uploads result to Firebase Storage
 * - Updates Firestore with output URLs
 */
router.post("/order", async (req, res) => {
  try {
    const { order_id, collection = "orders" } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" });
    }

    const result = await processOrder(order_id, collection);

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
 * Same as above but order_id from URL
 */
router.post("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { collection = "orders" } = req.body;

    const result = await processOrder(orderId, collection);

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
