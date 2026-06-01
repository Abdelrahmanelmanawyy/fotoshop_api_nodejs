import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Fake Supabase env so the route's middleware getSupabase() succeeds
// (client creation is lazy and does not connect). Set before importing.
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

const express = (await import("express")).default;
const processRoutes = (await import("../src/presentation/routes/process.js")).default;

const app = express();
app.use(express.json());
app.use("/process", processRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const PORT = server.address().port;

after(() => {
  server.close();
});

function postJson(path, json = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(json);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method: "POST",
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("POST /process/order → 400 when order_id missing", async () => {
  const res = await postJson("/process/order", {});
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.body).error, /order_id/);
});

test("POST /process/order → 400 when order_id has illegal characters", async () => {
  const res = await postJson("/process/order", { order_id: "bad id with spaces!" });
  assert.equal(res.status, 400);
});

test("POST /process/order/:orderId → 400 when orderId sanitizes to empty", async () => {
  const res = await postJson("/process/order/%20%20", {});
  assert.equal(res.status, 400);
});
