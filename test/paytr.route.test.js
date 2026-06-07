import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Set fake env BEFORE importing anything that reads it. We build our own app
// (not src/index.js) to avoid load-env.js overriding these with .env values.
process.env.SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.PAYTR_MERCHANT_ID = "100000";
process.env.PAYTR_MERCHANT_KEY = "testkey";
process.env.PAYTR_MERCHANT_SALT = "testsalt";
process.env.PAYTR_CALLBACK_URL = "https://example.com/paytr/callback";
process.env.PAYTR_TEST_MODE = "1";
process.env.PRINT_PRICE_TRY = "49.99";

const express = (await import("express")).default;
const paytrRoutes = (await import("../src/presentation/routes/paytr.js")).default;

const app = express();
app.use(express.json());
app.use("/paytr", paytrRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const PORT = server.address().port;

after(() => {
  server.close();
});

// Drive the local server via node:http (NOT global fetch), so that stubbing
// outbound fetch traffic (PayTR / Supabase) never collides with the test client.
function request(method, path, { json, form } = {}) {
  return new Promise((resolve, reject) => {
    let body;
    const headers = {};
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers["Content-Type"] = "application/json";
    } else if (form !== undefined) {
      body = new URLSearchParams(form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    if (body) headers["Content-Length"] = Buffer.byteLength(body);

    const req = http.request(
      { host: "127.0.0.1", port: PORT, method, path, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Stub the route's OUTBOUND calls by swapping global fetch. Safe because the
 * test client above uses node:http, not fetch — so there is no collision.
 * Returns a restore function.
 */
function stubOutboundFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("paytr.com")) {
      return new Response(JSON.stringify({ status: "success", token: "faketoken" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Supabase REST insert — return empty array so postgrest parses cleanly.
    return new Response("[]", {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("POST /paytr/token → 400 when required fields missing", async () => {
  const res = await request("POST", "/paytr/token", { json: { uid: "u1" } });
  assert.equal(res.status, 400);
});

test("POST /paytr/token → 400 when imageUrls is empty array", async () => {
  const res = await request("POST", "/paytr/token", {
    json: { uid: "u1", imageUrls: [], boothCode: "B001" },
  });
  assert.equal(res.status, 400);
});

test("POST /paytr/token → 400 when imageUrls exceeds the per-order cap", async () => {
  // MAX_PHOTOS_PER_ORDER is 10; 999 must be rejected.
  const urls = Array.from(
    { length: 999 },
    (_, i) => `https://cdn.example.com/${i}.jpg`
  );
  const res = await request("POST", "/paytr/token", {
    json: { uid: "u1", imageUrls: urls, boothCode: "B001" },
  });
  assert.equal(res.status, 400);
});

test("POST /paytr/token → 400 when imageUrl is not https", async () => {
  const res = await request("POST", "/paytr/token", {
    json: { uid: "u1", imageUrl: "http://insecure.example.com/a.jpg", boothCode: "B001" },
  });
  assert.equal(res.status, 400);
});

test("POST /paytr/token → 400 when paperFinish is invalid", async () => {
  const res = await request("POST", "/paytr/token", {
    json: {
      uid: "u1",
      imageUrl: "https://cdn.example.com/a.jpg",
      boothCode: "B001",
      paperFinish: "shiny-rainbow",
    },
  });
  assert.equal(res.status, 400);
});

test("POST /paytr/token → 200 happy path (legacy single imageUrl)", async () => {
  const restore = stubOutboundFetch();
  try {
    const res = await request("POST", "/paytr/token", {
      json: {
        uid: "u1",
        imageUrl: "https://cdn.example.com/a.jpg",
        boothCode: "B001",
        paperFinish: "glossy",
      },
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.token, "faketoken");
    assert.ok(body.orderId && body.orderId.startsWith("pr"));
    // Single photo → single-sheet price.
    assert.equal(body.priceTry, 49.99);
  } finally {
    restore();
  }
});

test("POST /paytr/token → 200 multi-photo bundle uses tier price", async () => {
  const restore = stubOutboundFetch();
  try {
    const res = await request("POST", "/paytr/token", {
      json: {
        uid: "u1",
        imageUrls: [
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.jpg",
        ],
        boothCode: "B001",
        paperFinish: "glossy",
      },
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    // 2-photo bundle = ₺89.99 per the tier table, NOT 2 × 49.99.
    assert.equal(body.priceTry, 89.99);
  } finally {
    restore();
  }
});

test("POST /paytr/token → 200 normalizes 'Glossy Premium' to canonical glossy", async () => {
  const restore = stubOutboundFetch();
  try {
    const res = await request("POST", "/paytr/token", {
      json: {
        uid: "u1",
        imageUrl: "https://cdn.example.com/a.jpg",
        boothCode: "B001",
        paperFinish: "Glossy Premium",
      },
    });
    // Used to be 400 — the new normalizer accepts friendly forms.
    assert.equal(res.status, 200);
  } finally {
    restore();
  }
});

test("POST /paytr/callback → responds OK and does not crash on bad hash", async () => {
  const res = await request("POST", "/paytr/callback", {
    form: {
      merchant_oid: "pr_x",
      status: "success",
      total_amount: "4999",
      hash: "definitely-wrong-hash",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body, "OK");
});
