/**
 * How long an order may sit in 'processing' without a heartbeat (orders.updated_at,
 * bumped after every finished photo) before it is considered abandoned.
 *
 * Shared by the processing claim (a stale 'processing' order may be re-claimed) and
 * the sweeper (which re-processes or refunds stale orders), so both agree on what
 * "stuck" means. Must exceed the longest single-photo model timeout
 * (REPLICATE_TIMEOUT_MS 3 min, OPENAI_TIMEOUT_MS 5 min by default).
 */
function envInt(name, fallback) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const PROCESSING_STALE_MS = envInt("SWEEP_PROCESSING_GRACE_MS", 12 * 60 * 1000);
