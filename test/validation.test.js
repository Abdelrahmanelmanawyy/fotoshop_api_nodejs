import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeCollectionName, sanitizeOrderId } from "../src/core/validation.js";

test("sanitizeOrderId accepts valid ids", () => {
  assert.equal(sanitizeOrderId("ORD_123"), "ORD_123");
  assert.equal(sanitizeOrderId("  abc-1  "), "abc-1");
});

test("sanitizeOrderId rejects empty or invalid", () => {
  assert.equal(sanitizeOrderId(""), null);
  assert.equal(sanitizeOrderId(null), null);
  assert.equal(sanitizeOrderId("../../etc/passwd"), null);
});

test("sanitizeCollectionName allows only whitelisted tables", () => {
  assert.equal(sanitizeCollectionName(undefined), "orders");
  assert.equal(sanitizeCollectionName("orders"), "orders");
  // Not on the allowlist → falls back to the default table, never an
  // attacker-chosen one (the value is used as the table the service-role
  // client queries).
  assert.equal(sanitizeCollectionName("my_orders"), "orders");
  assert.equal(sanitizeCollectionName("bad;drop"), "orders");
});
