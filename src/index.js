import "dotenv/config";
import express from "express";
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
    },
  });
});

app.get("/health", (req, res) => {
  console.log("[API] GET /health");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/process", processRoutes);

app.listen(PORT, () => {
  console.log(`Fotoshop API running on http://localhost:${PORT}`);
});
