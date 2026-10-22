import assert from "node:assert/strict";
import test from "node:test";

import { applyCoupon, validateCouponCode } from "../src/domain/couponService.js";

/** Minimal stand-in for the supabase-js query builder that records the filters used. */
function fakeSupabase(row) {
  const ops = [];
  const query = {
    select: (...a) => (ops.push(["select", ...a]), query),
    eq: (...a) => (ops.push(["eq", ...a]), query),
    ilike: (...a) => (ops.push(["ilike", ...a]), query),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { ops, from: (t) => (ops.push(["from", t]), query) };
}

const ACTIVE = {
  id: "c1",
  code: "SUMMER50",
  active: true,
  discount_type: "percent",
  discount_value: 50,
  max_uses: null,
  used_count: 0,
};

test("coupon lookup is an exact match on the upper-cased code (no wildcard matching)", async () => {
  const sb = fakeSupabase(null);
  await validateCouponCode(sb, "  sum%  ");
  assert.ok(!sb.ops.some(([op]) => op === "ilike"), "must not use ilike");
  assert.deepEqual(sb.ops.find(([op, col]) => op === "eq" && col === "code"), ["eq", "code", "SUM%"]);
});

test("validateCouponCode rejects used-up and expired coupons", async () => {
  const usedUp = await validateCouponCode(fakeSupabase({ ...ACTIVE, max_uses: 3, used_count: 3 }), "SUMMER50");
  assert.match(usedUp.error, /maximum/);

  const expired = await validateCouponCode(
    fakeSupabase({ ...ACTIVE, valid_until: "2000-01-01T00:00:00Z" }),
    "SUMMER50"
  );
  assert.match(expired.error, /expired/);

  const ok = await validateCouponCode(fakeSupabase(ACTIVE), "summer50");
  assert.equal(ok.coupon.id, "c1");
});

test("applyCoupon: percent and fixed discounts never go below zero", () => {
  assert.deepEqual(
    applyCoupon(100, { discount_type: "percent", discount_value: 25 }).discountedAmount,
    75
  );
  const fixed = applyCoupon(30, { discount_type: "fixed_try", discount_value: 50 });
  assert.equal(fixed.discountedAmount, 0);
  assert.equal(fixed.discountTry, 30);
});
