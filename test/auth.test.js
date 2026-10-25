import assert from "node:assert/strict";
import { test, afterEach } from "node:test";

import { resolveUserId } from "../src/presentation/middleware/auth.js";

afterEach(() => {
  delete process.env.REQUIRE_AUTH;
});

test("resolveUserId uses the JWT identity", () => {
  assert.deepEqual(resolveUserId({ user: { id: "jwt-user" } }, undefined), { ok: true, uid: "jwt-user" });
  assert.deepEqual(resolveUserId({ user: { id: "jwt-user" } }, "jwt-user"), { ok: true, uid: "jwt-user" });
});

test("resolveUserId rejects a body uid that differs from the token (acting for someone else)", () => {
  const r = resolveUserId({ user: { id: "jwt-user" } }, "victim");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("resolveUserId falls back to body uid only in soft mode", () => {
  assert.deepEqual(resolveUserId({}, " legacy-user "), { ok: true, uid: "legacy-user" });

  process.env.REQUIRE_AUTH = "1";
  const r = resolveUserId({}, "legacy-user");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("resolveUserId requires some identity", () => {
  const r = resolveUserId({}, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});
