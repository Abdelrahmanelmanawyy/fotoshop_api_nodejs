import assert from "node:assert/strict";
import http from "node:http";
import { test, after } from "node:test";
import express from "express";

import { keyFor, rateLimit } from "../src/presentation/middleware/rateLimit.js";

test("keyFor prefers the user id, then req.ip — never the raw X-Forwarded-For header", () => {
  assert.equal(keyFor({ user: { id: "u1" }, ip: "1.1.1.1", headers: {} }), "u:u1");
  assert.equal(
    keyFor({ ip: "1.1.1.1", headers: { "x-forwarded-for": "9.9.9.9" } }),
    "ip:1.1.1.1"
  );
});

// Behind one proxy (trust proxy = 1), a client that forges X-Forwarded-For entries
// must still land in the same bucket: Express takes the hop the proxy appended.
const app = express();
app.set("trust proxy", 1);
app.get("/", rateLimit({ windowMs: 60_000, max: 2, name: "test" }), (_req, res) => res.send("ok"));
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
after(() => server.close());

function get(xff) {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: "127.0.0.1", port: server.address().port, path: "/", headers: { "x-forwarded-for": xff } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }
      )
      .on("error", reject);
  });
}

test("spoofed X-Forwarded-For values cannot reset the rate limit", async () => {
  // Real client is 203.0.113.7 (appended by the proxy); the left entries are forged.
  const statuses = [];
  for (const forged of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
    statuses.push(await get(`${forged}, 203.0.113.7`));
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});
