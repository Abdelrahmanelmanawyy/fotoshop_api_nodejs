/**
 * GET /health — liveness + background-job visibility.
 *
 * Fast mode (default) makes no external calls and does not log (uptime checks hit it
 * every minute). It returns 503 `degraded` when the order sweeper should be running but has
 * not completed a run within 3x its interval — this is how a stale/misconfigured box is noticed.
 * `full=1` additionally verifies the Replicate token.
 *
 * Dependencies are injected so the handler can be tested without importing src/index.js.
 */
export function createHealthHandler({
  getSweeperStatus,
  verifyReplicateAuth,
  env = process.env,
  now = () => Date.now(),
}) {
  function evaluateSweeper() {
    const s = getSweeperStatus();
    const expected = env.DISABLE_ORDER_SWEEPER !== "1";
    const info = { running: !!s.running, lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null };
    if (!expected) return { info, degraded: false };

    if (!s.running) return { info, degraded: true };
    // Before the first run completes, measure from when the sweeper started.
    const reference = s.lastRunAt ?? s.startedAt ?? 0;
    // A tick that is mid-flight (re-processing a slow order) is legitimately quiet for longer.
    const limitMs = s.busy ? Math.max(3 * s.intervalMs, s.busyGraceMs ?? 0) : 3 * s.intervalMs;
    return { info, degraded: now() - reference > limitMs };
  }

  return async function healthHandler(req, res) {
    const full = req.query.full === "1" || req.query.full === "true";
    const { info, degraded } = evaluateSweeper();
    const body = {
      status: degraded ? "degraded" : "ok",
      timestamp: new Date(now()).toISOString(),
      sweeper: info,
    };

    if (full) {
      console.log("[API] GET /health?full=1");
      try {
        const replicate = await verifyReplicateAuth();
        body.replicate = replicate.ok ? "ok" : "error";
        if (!replicate.ok) body.replicate_message = replicate.message;
      } catch (e) {
        console.error("[API] health replicate check failed:", e?.message ?? e);
        body.replicate = "error";
      }
    }
    res.status(degraded ? 503 : 200).json(body);
  };
}
