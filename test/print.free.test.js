import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

// Routing fake for the Supabase REST API, installed before the client is created.
const db = { coupon: null, rpcError: null, calls: [] };

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  db.calls.push({ method, path: u.pathname, body });
  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  if (u.pathname.endsWith("/coupons")) {
    const accept = new Headers(init.headers).get("accept") || "";
    if (accept.includes("vnd.pgrst.object")) {
      return db.coupon ? json(200, db.coupon) : json(406, { code: "PGRST116", message: "0 rows" });
    }
    return json(200, db.coupon ? [db.coupon] : []);
  }
  if (u.pathname.endsWith("/app_pricing")) return json(200, []); // defaults: single 49.99, bundle_2 89.99
  if (u.pathname.endsWith("/rpc/create_free_print_jobs")) {
    if (db.rpcError) return json(400, { code: "P0001", message: db.rpcError });
    return json(200, body.p_image_urls.map((_, i) => `freeX_${i}`));
  }
  return json(404, { message: `unexpected ${method} ${u.pathname}` });
};

const express = (await import("express")).default;
const printRoutes = (await import("../src/presentation/routes/print.js")).default;

const app = express();
app.use(express.json());
app.use("/print", printRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
after(() => server.close());

const IMG = (n) => `https://fake.supabase.co/storage/v1/object/public/uploads/print/u1/${n}.jpg`;

function post(json) {
  const body = JSON.stringify(json);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        method: "POST",
        path: "/print/free",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const rpcCalls = () => db.calls.filter((c) => c.path.endsWith("/rpc/create_free_print_jobs"));

beforeEach(() => {
  db.calls = [];
  db.rpcError = null;
  db.coupon = null;
});

test("free prints: one job per photo, entitlement consumed in SQL for the JWT/body user", async () => {
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: [IMG(1), IMG(2)] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.jobIds, ["freeX_0", "freeX_1"]);
  const [call] = rpcCalls();
  assert.equal(call.body.p_uid, "u1");
  assert.equal(call.body.p_coupon_id, null);
  assert.deepEqual(call.body.p_image_urls, [IMG(1), IMG(2)]);
});

test("free prints: not enough free prints left → 409, nothing else written", async () => {
  db.rpcError = "no_free_prints";
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: [IMG(1)] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "no_free_prints");
});

test("images outside Fotoshop storage are rejected before any database call", async () => {
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: ["https://evil.example.com/a.jpg"] });
  assert.equal(res.status, 400);
  assert.equal(db.calls.length, 0);
});

test("a coupon that does not cover the server price cannot make a print free", async () => {
  db.coupon = { id: "c1", code: "HALF", active: true, discount_type: "percent", discount_value: 50, max_uses: null, used_count: 0 };
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: [IMG(1)], couponCode: "half" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "coupon_not_full_price");
  assert.equal(rpcCalls().length, 0);
});

test("a 100% coupon is passed to SQL (which enforces max_uses atomically)", async () => {
  db.coupon = { id: "c1", code: "FREE", active: true, discount_type: "percent", discount_value: 100, max_uses: 1, used_count: 0 };
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: [IMG(1)], couponCode: "FREE" });
  assert.equal(res.status, 200);
  const [call] = rpcCalls();
  assert.equal(call.body.p_coupon_id, "c1");
  assert.equal(call.body.p_discount_try, 49.99);
});

test("a coupon used up concurrently surfaces as 409 from SQL", async () => {
  db.coupon = { id: "c1", code: "FREE", active: true, discount_type: "percent", discount_value: 100, max_uses: 1, used_count: 0 };
  db.rpcError = "coupon_unavailable";
  const res = await post({ uid: "u1", boothCode: "B001", imageUrls: [IMG(1)], couponCode: "FREE" });
  assert.equal(res.status, 409);
});
