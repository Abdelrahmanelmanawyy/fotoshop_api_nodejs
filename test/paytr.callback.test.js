import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

// Fake env BEFORE importing the route (see paytr.route.test.js for why we build our own app).
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.PAYTR_MERCHANT_KEY = "testkey";
process.env.PAYTR_MERCHANT_SALT = "testsalt";

// One routing fake for the Supabase REST API, installed before the Supabase client
// is created (the client captures fetch on creation). Tests steer it through `db`.
const db = { tx: null, failPrintJobs: false, calls: [] };

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  db.calls.push({ method, path: u.pathname, search: u.search, body });

  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  if (u.pathname.endsWith("/payment_transactions") && method === "GET") {
    const accept = new Headers(init.headers).get("accept") || "";
    if (accept.includes("vnd.pgrst.object")) {
      return db.tx ? json(200, db.tx) : json(406, { code: "PGRST116", message: "0 rows" });
    }
    return json(200, db.tx ? [db.tx] : []);
  }
  if (u.pathname.endsWith("/payment_transactions") && method === "PATCH") {
    db.tx = { ...db.tx, ...body };
    return json(200, []);
  }
  if (u.pathname.endsWith("/print_jobs")) {
    return db.failPrintJobs
      ? json(500, { code: "XX000", message: "insert failed" })
      : json(201, []);
  }
  if (u.pathname.includes("/rpc/")) return json(200, null);
  return json(404, { message: `unexpected ${method} ${u.pathname}` });
};

const express = (await import("express")).default;
const paytrRoutes = (await import("../src/presentation/routes/paytr.js")).default;

const app = express();
app.use(express.json());
app.use("/paytr", paytrRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const PORT = server.address().port;
after(() => server.close());

function sign(oid, status, totalAmount) {
  return crypto
    .createHmac("sha256", "testkey")
    .update(`${oid}testsalt${status}${totalAmount}`)
    .digest("base64");
}

function callback({ oid = "prTEST", status = "success", total = "4999" } = {}) {
  const form = new URLSearchParams({
    merchant_oid: oid,
    status,
    total_amount: total,
    hash: sign(oid, status, total),
  }).toString();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method: "POST",
        path: "/paytr/callback",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(form),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(form);
    req.end();
  });
}

const callsTo = (suffix, method) =>
  db.calls.filter((c) => c.path.endsWith(suffix) && (!method || c.method === method));

beforeEach(() => {
  db.calls = [];
  db.failPrintJobs = false;
  db.tx = {
    id: "prTEST",
    uid: "u1",
    status: "wait",
    amount_try: 49.99,
    booth_code: "B001",
    paper_finish: "glossy",
    image_urls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    coupon_id: "coupon-1",
  };
});

test("callback success → one print job per photo, tx marked paid, coupon counted", async () => {
  const res = await callback();
  assert.equal(res.status, 200);
  assert.equal(res.body, "OK");

  const inserts = callsTo("/print_jobs", "POST");
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].body.map((r) => r.id), ["prTEST_0", "prTEST_1"]);
  assert.ok(inserts[0].body.every((r) => r.is_paid_by_money === true && r.user_id === "u1"));

  assert.equal(db.tx.status, "paid");
  assert.equal(callsTo("/rpc/increment_coupon_used_count").length, 1);
});

test("callback re-delivery for an already paid tx → OK without creating jobs again", async () => {
  db.tx.status = "paid";
  const res = await callback();
  assert.equal(res.body, "OK");
  assert.equal(callsTo("/print_jobs").length, 0);
  assert.equal(callsTo("/rpc/increment_coupon_used_count").length, 0);
});

test("callback when print_jobs insert fails → non-OK so PayTR retries, tx stays 'wait'", async () => {
  db.failPrintJobs = true;
  const res = await callback();
  assert.equal(res.status, 500);
  assert.notEqual(res.body, "OK");
  assert.equal(db.tx.status, "wait");
  assert.equal(callsTo("/payment_transactions", "PATCH").length, 0);
});

test("callback paying less than the order price → no jobs, flagged for review", async () => {
  const res = await callback({ total: "100" });
  assert.equal(res.body, "OK");
  assert.equal(callsTo("/print_jobs").length, 0);
  assert.equal(db.tx.status, "amount_mismatch");
});

test("callback for a failed payment → tx marked unpaid, no jobs", async () => {
  const res = await callback({ status: "failed", total: "4999" });
  assert.equal(res.body, "OK");
  assert.equal(callsTo("/print_jobs").length, 0);
  assert.equal(db.tx.status, "unpaid");
});
