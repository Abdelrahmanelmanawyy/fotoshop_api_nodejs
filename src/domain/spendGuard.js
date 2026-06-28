/**
 * Global spend circuit breaker.
 *
 * Independent of per-user rate limits: this caps the TOTAL estimated Replicate/
 * OpenAI spend across all users in a rolling hour and day. If a bug, a viral
 * spike, or abuse pushes spend past the ceiling, new generations are rejected
 * with 503 until the window rolls over — bounding the worst-case bill.
 *
 * In-memory per-process (single instance today). For multi-instance, back this
 * with a shared counter (Redis/Postgres). See PRODUCTION_READINESS_PLAN §2.2/§5.
 */

function envFloat(name, fallback) {
  const v = parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Estimated cost per generated image (USD). nano-banana ~$0.04, gpt-image ~$0.05–0.13.
const COST_PER_IMAGE = envFloat("EST_COST_PER_IMAGE_USD", 0.06);
const HOURLY_CAP = envFloat("SPEND_CAP_HOURLY_USD", 50);
const DAILY_CAP = envFloat("SPEND_CAP_DAILY_USD", 500);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let hour = { spend: 0, resetAt: Date.now() + HOUR_MS };
let day = { spend: 0, resetAt: Date.now() + DAY_MS };

function roll(window, length) {
  const now = Date.now();
  if (window.resetAt <= now) {
    window.spend = 0;
    window.resetAt = now + length;
  }
}

/**
 * Returns { ok: true } if a job of `images` images can proceed, else
 * { ok: false, window, message } when it would exceed a cap.
 */
export function canSpend(images = 1) {
  roll(hour, HOUR_MS);
  roll(day, DAY_MS);
  const cost = images * COST_PER_IMAGE;

  if (hour.spend + cost > HOURLY_CAP) {
    return { ok: false, window: "hour", message: `Hourly spend cap reached ($${HOURLY_CAP})` };
  }
  if (day.spend + cost > DAILY_CAP) {
    return { ok: false, window: "day", message: `Daily spend cap reached ($${DAILY_CAP})` };
  }
  return { ok: true };
}

/** Record that `images` images were (attempted to be) generated. */
export function recordSpend(images = 1) {
  roll(hour, HOUR_MS);
  roll(day, DAY_MS);
  const cost = images * COST_PER_IMAGE;
  hour.spend += cost;
  day.spend += cost;
  // Early-warning log at 80% of either cap (wire to an alert in §5.3).
  if (hour.spend > HOURLY_CAP * 0.8 || day.spend > DAILY_CAP * 0.8) {
    console.warn(
      `[SpendGuard] APPROACHING CAP — hour=$${hour.spend.toFixed(2)}/${HOURLY_CAP} ` +
      `day=$${day.spend.toFixed(2)}/${DAILY_CAP}`
    );
  }
}

/** Express middleware: blocks the request if the global cap is hit. */
export function spendCapGuard(req, res, next) {
  const check = canSpend(1);
  if (!check.ok) {
    console.error(`[SpendGuard] BLOCKED ${req.method} ${req.originalUrl}: ${check.message}`);
    return res.status(503).json({
      error: "service_busy",
      message: "We're experiencing very high demand right now. Please try again later.",
    });
  }
  next();
}

/** For diagnostics / health. */
export function spendSnapshot() {
  roll(hour, HOUR_MS);
  roll(day, DAY_MS);
  return {
    hour_usd: Number(hour.spend.toFixed(2)),
    hour_cap_usd: HOURLY_CAP,
    day_usd: Number(day.spend.toFixed(2)),
    day_cap_usd: DAILY_CAP,
  };
}
