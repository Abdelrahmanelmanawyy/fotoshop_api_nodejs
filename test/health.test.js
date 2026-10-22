import assert from "node:assert/strict";
import http from "node:http";
import { test, after } from "node:test";
import express from "express";

import { createHealthHandler } from "../src/presentation/routes/health.js";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const INTERVAL = 90_000;

let sweeper;
let env;
let replicate;
let logged = [];
const realLog = console.log;
console.log = (...args) => logged.push(args.join(" "));
after(() => {
  console.log = realLog;
  server.close();
});

const app = express();
app.get(
  "/health",
  createHealthHandler({
    getSweeperStatus: () => sweeper,
    verifyReplicateAuth: async () => replicate,
    env: new Proxy({}, { get: (_t, k) => env[k] }),
    now: () => NOW,
  })
);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));

function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: server.address().port, path }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      })
      .on("error", reject);
  });
}

function healthySweeper(overrides = {}) {
  return {
    running: true,
    startedAt: NOW - 3_600_000,
    lastRunAt: NOW - 30_000,
    lastError: null,
    busy: false,
    intervalMs: INTERVAL,
    busyGraceMs: 900_000,
    ...overrides,
  };
}

function reset() {
  sweeper = healthySweeper();
  env = {};
  replicate = { ok: true };
  logged = [];
}

test("healthy sweeper: 200, status ok, shape is status/timestamp/sweeper", async () => {
  reset();
  const { status, body } = await get("/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.timestamp, new Date(NOW).toISOString());
  assert.deepEqual(body.sweeper, { running: true, lastRunAt: new Date(NOW - 30_000).toISOString() });
  assert.deepEqual(Object.keys(body).sort(), ["status", "sweeper", "timestamp"]);
});

test("fast /health does not log per request", async () => {
  reset();
  await get("/health");
  assert.equal(logged.length, 0);
});

test("last run older than 3x interval: 503 degraded", async () => {
  reset();
  sweeper = healthySweeper({ lastRunAt: NOW - 3 * INTERVAL - 1 });
  const { status, body } = await get("/health");
  assert.equal(status, 503);
  assert.equal(body.status, "degraded");
});

test("last run just inside 3x interval is still ok", async () => {
  reset();
  sweeper = healthySweeper({ lastRunAt: NOW - 3 * INTERVAL });
  assert.equal((await get("/health")).status, 200);
});

test("sweeper never started (e.g. stale box / init failure): 503 degraded", async () => {
  reset();
  sweeper = healthySweeper({ running: false, lastRunAt: null, startedAt: null });
  const { status, body } = await get("/health");
  assert.equal(status, 503);
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.sweeper, { running: false, lastRunAt: null });
});

test("just started, first run not completed yet: ok; but degraded once 3x interval passes", async () => {
  reset();
  sweeper = healthySweeper({ lastRunAt: null, startedAt: NOW - 20_000 });
  assert.equal((await get("/health")).status, 200);
  sweeper = healthySweeper({ lastRunAt: null, startedAt: NOW - 3 * INTERVAL - 1 });
  assert.equal((await get("/health")).status, 503);
});

test("a long tick in progress is tolerated up to busyGraceMs", async () => {
  reset();
  sweeper = healthySweeper({ busy: true, lastRunAt: NOW - 10 * 60_000 });
  assert.equal((await get("/health")).status, 200);
  sweeper = healthySweeper({ busy: true, lastRunAt: NOW - 16 * 60_000 });
  assert.equal((await get("/health")).status, 503);
});

test("DISABLE_ORDER_SWEEPER=1: a stopped sweeper is not degraded", async () => {
  reset();
  env = { DISABLE_ORDER_SWEEPER: "1" };
  sweeper = healthySweeper({ running: false, lastRunAt: null, startedAt: null });
  const { status, body } = await get("/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
});

test("full=1 adds the replicate check and logs; replicate error alone does not degrade", async () => {
  reset();
  replicate = { ok: false, message: "bad token" };
  const { status, body } = await get("/health?full=1");
  assert.equal(status, 200);
  assert.equal(body.replicate, "error");
  assert.equal(body.replicate_message, "bad token");
  assert.equal(logged.length, 1);
});

test("full=1 still reports a stale sweeper as 503", async () => {
  reset();
  sweeper = healthySweeper({ running: false, lastRunAt: null, startedAt: null });
  const { status, body } = await get("/health?full=1");
  assert.equal(status, 503);
  assert.equal(body.replicate, "ok");
});
