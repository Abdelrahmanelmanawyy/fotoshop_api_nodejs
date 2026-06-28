/**
 * Hard timeout wrapper for external calls.
 *
 * The Replicate SDK's run() polls until the prediction finishes — if a job hangs
 * (we saw one run 1h5m before failing), the request would hang with it, the user
 * would spin forever, and no refund would fire. withTimeout guarantees the call
 * rejects after `ms`, turning a hang into a terminal failure the caller can refund.
 *
 * Note: rejecting here does not cancel the upstream prediction (it may keep
 * running/billing once), but it frees our worker and unblocks the refund path.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label  human-readable name used in the timeout error
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Timeout (ms) for a single Replicate prediction. Default 3 min, env-overridable. */
export function replicateTimeoutMs() {
  const v = parseInt(process.env.REPLICATE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 180000;
}

/** Timeout (ms) for a single OpenAI image edit. Default 5 min (gpt-image is slow). */
export function openaiTimeoutMs() {
  const v = parseInt(process.env.OPENAI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 300000;
}
