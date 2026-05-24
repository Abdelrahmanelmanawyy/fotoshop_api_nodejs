import "./load-env.js";
import express from "express";
import { assertReplicateConfigured, verifyReplicateAuth } from "./data/replicate.js";
import biometricRoutes from "./presentation/routes/biometric.js";
import processRoutes from "./presentation/routes/process.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "Fotoshop API",
    version: "1.0.0",
    endpoints: {
      "POST /process/order": "Process order by order_id in body",
      "POST /process/order/:orderId": "Process order by orderId in URL",
      "POST /biometric/process": "Biometric photo via PhotoXBox (multipart: image, package)",
    },
  });
});

/** Fast liveness check (no external APIs). Use GET /health?full=1 to verify Replicate too. */
app.get("/health", async (req, res) => {
  const full = req.query.full === "1" || req.query.full === "true";
  if (!full) {
    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }

  console.log("[API] GET /health?full=1");
  const replicate = await verifyReplicateAuth();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    replicate: replicate.ok ? "ok" : "error",
    replicate_message: replicate.ok ? undefined : replicate.message,
  });
});

app.use("/process", processRoutes);
app.use("/biometric", biometricRoutes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fotoshop API listening on 0.0.0.0:${PORT} (use public IP:PORT from phones/other networks)`);
  void assertReplicateConfigured();
});
