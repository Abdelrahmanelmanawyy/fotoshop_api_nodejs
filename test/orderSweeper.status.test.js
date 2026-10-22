import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-key";
const { getSweeperStatus, startOrderSweeper } = await import("../src/domain/orderSweeper.js");

test("sweeper status: not running before start, running after start, stopped after stop()", () => {
  let s = getSweeperStatus();
  assert.equal(s.running, false);
  assert.equal(s.lastRunAt, null);
  assert.equal(s.lastError, null);
  assert.ok(s.intervalMs > 0);

  const realLog = console.log;
  console.log = () => {};
  const stop = startOrderSweeper();
  console.log = realLog;
  s = getSweeperStatus();
  assert.equal(s.running, true);
  assert.equal(typeof s.startedAt, "number");
  assert.equal(s.lastRunAt, null); // no run has completed yet

  stop();
  assert.equal(getSweeperStatus().running, false);
});
