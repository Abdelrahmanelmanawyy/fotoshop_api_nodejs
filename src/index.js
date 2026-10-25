import "./instrument.js"; // must stay first: loads .env and starts crash reporting (if SENTRY_DSN is set)
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
import printRoutes from "./presentation/routes/print.js";
import stripeRoutes, { stripeWebhookHandler } from "./presentation/routes/stripe.js";
import { authenticate } from "./presentation/middleware/auth.js";
import { requireSupabase } from "./presentation/middleware/requireSupabase.js";
import {
  aiRateLimiter,
  aiDailyRateLimiter,
  generalRateLimiter,
} from "./presentation/middleware/rateLimit.js";
import { spendCapGuard } from "./domain/spendGuard.js";
import { startOrderSweeper, getSweeperStatus } from "./domain/orderSweeper.js";
import { createHealthHandler } from "./presentation/routes/health.js";
import { reportError, flushErrorReporting } from "./core/errorReporting.js";

const app = express();
const PORT = process.env.PORT || 3000;

// How many reverse proxies sit in front of Node (Cloudflare = 1, Cloudflare + nginx = 2).
// Express then derives req.ip from the right-most untrusted X-Forwarded-For hop,
// which a client cannot spoof. Rate limiting and PayTR's user_ip depend on it.
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

function parseTrustProxy(value) {
  if (value === undefined || value === "") return 1;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value; // e.g. "loopback, 10.0.0.0/8"
}

// --- CORS (web version: photoshopapp.com) ---------------------------------
// The mobile app is a native client and ignores CORS, so this only affects the
// browser build. Allowed origins come from CORS_ALLOWED_ORIGINS (comma-list);
// defaults cover the production web domain + local Flutter web dev.
const corsAllowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ||
  "https://app.fotoshopapp.xyz,https://fotoshopapp.xyz,https://www.fotoshopapp.xyz"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Baseline security headers (PRODUCTION_READINESS_PLAN §2.3) — the API serves
// JSON only, so a strict no-sniff/no-frame/no-referrer posture is safe. Kept
// dependency-free (no helmet) to match the zero-new-deps constraint.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // images fetched by app/web
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsAllowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Stripe webhook needs the RAW request body for signature verification, so it
// MUST be registered before the JSON body parser below.
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// JSON bodies are tiny (order ids, receipt payloads). IAP receipts are the
// largest legitimate payload; 1 MB is generous headroom while blocking abuse.
app.use(express.json({ limit: "1mb" }));

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

  // Stripe (web version credit purchases)
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("[ENV] Stripe: missing STRIPE_SECRET_KEY — /stripe/checkout will return errors until set.");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn("[ENV] Stripe: missing STRIPE_WEBHOOK_SECRET — all Stripe webhooks will be rejected, so web purchases will not grant credits.");
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
    if (!process.env.APPLE_APP_ID) {
      console.warn("[ENV] IAP/iOS: missing APPLE_APP_ID — StoreKit 2 (JWS) purchases can only be verified in Sandbox; production iOS 15+ purchases will fail.");
    }
    if (!process.env.APPLE_SHARED_SECRET) {
      console.warn("[ENV] IAP/iOS: missing APPLE_SHARED_SECRET — legacy base64 receipts (iOS < 15) will fail.");
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

/** Fast liveness check (no external APIs, no logging). 503 if the order sweeper is stale. GET /health?full=1 also verifies Replicate. */
app.get("/health", createHealthHandler({ getSweeperStatus, verifyReplicateAuth }));

// Cost-incurring routes: authenticate (soft until REQUIRE_AUTH=1), then rate-limit
// per user, then enforce the global spend circuit breaker.
app.use("/process", requireSupabase, authenticate, aiRateLimiter, aiDailyRateLimiter, spendCapGuard, processRoutes);
app.use("/biometric", authenticate, aiRateLimiter, aiDailyRateLimiter, spendCapGuard, biometricRoutes);

// These routers mix user actions (authenticated + rate-limited inside the
// router) with provider callbacks (signature-verified, no user JWT).
app.use("/paytr", requireSupabase, paytrRoutes);
app.use("/stripe", requireSupabase, stripeRoutes);

// Authenticated user actions — coarse rate limit, no spend guard.
app.use("/iap", requireSupabase, authenticate, generalRateLimiter, iapRoutes);
app.use("/coupon", requireSupabase, authenticate, generalRateLimiter, couponRoutes);
app.use("/print", requireSupabase, authenticate, generalRateLimiter, printRoutes);

// Public read-only.
app.use("/pricing", pricingRoutes);

// Global error handler — catches sync throws and rejected promises surfaced by Express.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[API] Unhandled route error:", err);
  // Client errors (e.g. malformed JSON body, status 4xx) are not crashes — don't page on them.
  const status = err?.status ?? err?.statusCode;
  if (!(status >= 400 && status < 500)) reportError(err, { area: "express" });
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

// Process-level safety nets. A rejected promise nobody awaited is logged; an
// uncaught exception leaves the process in an unknown state, so log and exit —
// pm2 restarts it and the order sweeper reconciles interrupted jobs on boot.
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled promise rejection:", reason);
  reportError(reason instanceof Error ? reason : new Error(String(reason)), { area: "unhandledRejection" });
});
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception — exiting:", err);
  reportError(err, { area: "uncaughtException" });
  // Give Sentry a moment to send the event (no-op when not configured); hard cap 2.5s.
  setTimeout(() => process.exit(1), 2500).unref();
  flushErrorReporting(2000).finally(() => process.exit(1));
});

export { app };

// Only start the server when run directly (not when imported by tests).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  let stopSweeper = null;
  const server = app.listen(PORT, "0.0.0.0", () => {
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
      // Reconcile zombie/stuck AI orders (refund or re-process). Safe to run on
      // a single instance; gate behind a leader election when scaling out.
      if (process.env.DISABLE_ORDER_SWEEPER !== "1") {
        stopSweeper = startOrderSweeper();
      }
    } catch (e) {
      console.error("[Supabase] Init failed:", e.message);
    }
  });

  // Graceful shutdown (PRODUCTION_READINESS_PLAN §6): on PM2 restart/deploy,
  // stop taking connections and let in-flight requests finish. Interrupted
  // generations are safe — the sweeper re-processes or refunds them on the
  // next boot. Hard-exit after 10s so a stuck socket can't block the deploy.
  const shutdown = (signal) => {
    console.log(`[Process] ${signal} received — shutting down gracefully`);
    if (stopSweeper) stopSweeper();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
