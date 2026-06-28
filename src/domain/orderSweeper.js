import * as database from "../data/database.js";
import { orderService } from "../composition/container.js";

/**
 * Reconciliation sweeper — the safety net for the client's fire-and-forget
 * trigger (ai_order_service.triggerBackendProcessing(...).ignore()).
 *
 * If that POST never reaches the backend (network drop, Cloudflare 502, EC2
 * restart), the paid order would sit in 'pending' forever: credit spent, nothing
 * produced, user never told. This periodically finds such orders and either
 * re-processes them or — once they're too old / too many attempts — refunds and
 * marks them failed. Covers F2/F3/F4 in PRODUCTION_READINESS_PLAN §1.2.4.
 *
 * Idempotent by construction: processOrder skips photos that already have an
 * output, and refund_order_credits refunds at most once.
 */

function envInt(name, fallback) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const INTERVAL_MS = envInt("SWEEP_INTERVAL_MS", 90 * 1000); // every 90s
const PENDING_GRACE_MS = envInt("SWEEP_PENDING_GRACE_MS", 2 * 60 * 1000); // 2 min
const PROCESSING_GRACE_MS = envInt("SWEEP_PROCESSING_GRACE_MS", 12 * 60 * 1000); // 12 min
const HARD_AGE_MS = envInt("SWEEP_HARD_AGE_MS", 15 * 60 * 1000); // give up & refund after 15 min
const MAX_ATTEMPTS = envInt("SWEEP_MAX_ATTEMPTS", 3);
const BATCH = envInt("SWEEP_BATCH", 20);

let running = false;

async function handleOrder(order) {
  const ageMs = Date.now() - new Date(order.created_at).getTime();
  const exhausted = (order.attempts ?? 0) >= MAX_ATTEMPTS || ageMs > HARD_AGE_MS;

  if (exhausted) {
    console.warn(
      `[Sweeper] Giving up on ${order.id} (status=${order.status} attempts=${order.attempts} ageMs=${ageMs}) → refund`
    );
    const refunded = await database.refundOrder(order.id);
    if (!refunded) {
      await database.setOrderStatus(order.id, "failed", "sweeper_refund_failed");
    }
    return;
  }

  console.log(`[Sweeper] Re-processing stuck order ${order.id} (status=${order.status}, attempt ${(order.attempts ?? 0) + 1})`);
  try {
    await orderService.processOrder(order.id);
  } catch (err) {
    // Leave it; next tick re-evaluates (attempts was bumped to 'processing').
    console.error(`[Sweeper] Re-process of ${order.id} threw: ${err.message}`);
  }
}

async function tick() {
  if (running) return; // never overlap ticks
  running = true;
  try {
    const stuck = await database.getStuckOrders({
      pendingGraceMs: PENDING_GRACE_MS,
      processingGraceMs: PROCESSING_GRACE_MS,
      limit: BATCH,
    });
    if (stuck.length) {
      console.log(`[Sweeper] Found ${stuck.length} stuck order(s)`);
    }
    for (const order of stuck) {
      await handleOrder(order);
    }
  } catch (err) {
    console.error(`[Sweeper] tick error: ${err.message}`);
  } finally {
    running = false;
  }
}

/** Start the periodic sweeper. Returns a stop() function. */
export function startOrderSweeper() {
  console.log(
    `[Sweeper] Started — every ${INTERVAL_MS}ms (pendingGrace=${PENDING_GRACE_MS}ms, ` +
    `processingGrace=${PROCESSING_GRACE_MS}ms, hardAge=${HARD_AGE_MS}ms, maxAttempts=${MAX_ATTEMPTS})`
  );
  const handle = setInterval(tick, INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  // Kick one shortly after boot so a restart immediately reconciles backlog.
  setTimeout(tick, 10 * 1000).unref?.();
  return () => clearInterval(handle);
}
