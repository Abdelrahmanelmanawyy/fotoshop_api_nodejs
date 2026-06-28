/**
 * Dependency-free in-memory rate limiter (fixed window).
 *
 * Every AI/biometric request costs real money on Replicate/OpenAI ($0.04–$0.13),
 * so an unlimited endpoint is a financial DoS. This caps requests per caller.
 *
 * Keyed by authenticated user id when present (req.user.id), else by client IP.
 * In-memory state is per-process — fine for the current single EC2 instance.
 * When the API scales horizontally (PRODUCTION_READINESS_PLAN §5.2), replace
 * this with a shared Redis-backed limiter so the window is global.
 */

function keyFor(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  return `ip:${ip}`;
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   window length in ms
 * @param {number} opts.max        max requests per key per window
 * @param {string} [opts.name]     label for logs
 */
export function rateLimit({ windowMs, max, name = "rate" }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  // Periodically evict expired buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, Math.max(windowMs, 60000));
  if (typeof sweep.unref === "function") sweep.unref();

  return function rateLimiter(req, res, next) {
    const key = keyFor(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      console.warn(`[RateLimit:${name}] ${key} blocked (${bucket.count}/${max})`);
      return res.status(429).json({
        error: "rate_limited",
        message: "Too many requests. Please slow down and try again shortly.",
        retry_after_seconds: retryAfter,
      });
    }

    return next();
  };
}

// Tunable via env so limits can be adjusted without a redeploy.
function envInt(name, fallback) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** AI / biometric generation: paid, expensive — strict per-user limits. */
export const aiRateLimiter = rateLimit({
  name: "ai",
  windowMs: 60000,
  max: envInt("RATE_AI_PER_MIN", 8),
});

export const aiDailyRateLimiter = rateLimit({
  name: "ai-day",
  windowMs: 24 * 60 * 60 * 1000,
  max: envInt("RATE_AI_PER_DAY", 200),
});

/** Cheaper endpoints (coupon/iap/stripe checkout) — coarse abuse backstop. */
export const generalRateLimiter = rateLimit({
  name: "general",
  windowMs: 60000,
  max: envInt("RATE_GENERAL_PER_MIN", 30),
});
