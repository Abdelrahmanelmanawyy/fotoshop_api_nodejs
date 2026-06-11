import "./load-env.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import express from "express";
import { assertReplicateConfigured, verifyReplicateAuth } from "./data/replicate.js";
import { getSupabase } from "./config/supabase.js";
import { subscribeToPricingChanges } from "./domain/printPricingService.js";
import biometricRoutes from "./presentation/routes/biometric.js";
import processRoutes from "./presentation/routes/process.js";
import paytrRoutes from "./presentation/routes/paytr.js";
import iapRoutes from "./presentation/routes/iap.js";
import pricingRoutes from "./presentation/routes/pricing.js";
import couponRoutes from "./presentation/routes/coupons.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/** Warn (don't crash) if important env vars are missing at startup. */
function checkEnv() {
  const groups = {
    Supabase: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    Replicate: ["REPLICATE_API_TOKEN"],
    PayTR: [
      "PAYTR_MERCHANT_ID",
      "PAYTR_MERCHANT_KEY",
      "PAYTR_MERCHANT_SALT",
      "PAYTR_CALLBACK_URL",
    ],
  };
  for (const [group, keys] of Object.entries(groups)) {
    const missing = keys.filter((k) => !process.env[k]);
    if (missing.length) {
      console.warn(`[ENV] ${group}: missing ${missing.join(", ")} — related features will return errors until set.`);
    }
  }

  // IAP credentials — only required when IAP_DEV_MODE is NOT set.
  if (process.env.IAP_DEV_MODE === "1") {
    console.warn(
      "[ENV] IAP_DEV_MODE=1 — /iap/verify will trust the client without contacting Google/Apple. DO NOT use in production."
    );
  } else {
    const iapAndroid = ["ANDROID_PACKAGE_NAME"].filter((k) => !process.env[k]);
    const iapAndroidCreds =
      !process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON &&
      !process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
    if (iapAndroid.length || iapAndroidCreds) {
      const parts = [...iapAndroid];
      if (iapAndroidCreds) parts.push("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_SERVICE_ACCOUNT_PATH");
      console.warn(`[ENV] IAP/Android: missing ${parts.join(", ")} — Android IAP verification will fail.`);
    }
    const iapIos = ["APPLE_SHARED_SECRET"].filter((k) => !process.env[k]);
    if (iapIos.length) {
      console.warn(`[ENV] IAP/iOS: missing ${iapIos.join(", ")} — iOS IAP verification will fail.`);
    }
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "Fotoshop API",
    version: "1.0.0",
    endpoints: {
      "POST /process/order": "Process order by order_id in body",
      "POST /process/order/:orderId": "Process order by orderId in URL",
      "POST /biometric/process": "Biometric photo via PhotoXBox (multipart: image, package)",
      "POST /iap/verify": "Verify Google Play / Apple IAP purchase and grant credits",
    },
  });
});

/** Fast liveness check (no external APIs). Use GET /health?full=1 to verify Replicate too. */
app.get("/health", async (req, res) => {
  const full = req.query.full === "1" || req.query.full === "true";
  if (!full) {
    console.log(`[API] GET /health from ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
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
app.use("/paytr", paytrRoutes);
app.use("/iap", iapRoutes);
app.use("/pricing", pricingRoutes);
app.use("/coupon", couponRoutes);

// Global error handler — catches sync throws and rejected promises surfaced by Express.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[API] Unhandled route error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

// Process-level safety nets — log instead of silently dying.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err);
});

export { app };

// Only start the server when run directly (not when imported by tests).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Fotoshop API listening on 0.0.0.0:${PORT} (use public IP:PORT from phones/other networks)`);
    checkEnv();
    assertReplicateConfigured().catch((e) =>
      console.error("[Replicate] startup check failed:", e?.message ?? e)
    );
    try {
      const supabase = getSupabase();
      console.log("[Supabase] Client initialized OK");
      // Live-invalidate the pricing cache whenever the admin dashboard saves
      // a price change in `app_pricing` (requires the pricing realtime migration).
      subscribeToPricingChanges(supabase);
    } catch (e) {
      console.error("[Supabase] Init failed:", e.message);
    }
  });
}
