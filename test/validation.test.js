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

test("sanitizeCollectionName defaults and validates", () => {
  assert.equal(sanitizeCollectionName(undefined), "orders");
  assert.equal(sanitizeCollectionName("my_orders"), "my_orders");
  assert.equal(sanitizeCollectionName("bad;drop"), "orders");
});
