import assert from "node:assert/strict";
import test from "node:test";
import { Environment, Type, VerificationException, VerificationStatus } from "@apple/app-store-server-library";

import { verifyAndGrant } from "../src/domain/iapService.js";
import { looksLikeJws, verifyAppleJws } from "../src/data/appleJws.js";

const JWS = "aaa.bbb.ccc";
const BASE = { uid: "u1", platform: "ios", productId: "credits_20", verificationData: JWS };

function fakeSupabase() {
  const ids = new Set();
  const state = { ids, rpcs: [] };
  return {
    state,
    from: () => ({
      insert: async (row) => {
        if (ids.has(row.id)) return { error: { code: "23505" } };
        ids.add(row.id);
        return { error: null };
      },
      delete: () => ({ eq: async (_c, id) => (ids.delete(id), { error: null }) }),
    }),
    rpc: async (name, args) => (state.rpcs.push([name, args]), { error: null }),
  };
}

const goodTx = {
  bundleId: "com.fotoshop.mobile",
  productId: "credits_20",
  type: Type.CONSUMABLE,
  transactionId: "2000001",
};
const okJws = (tx = {}) => async () => ({ ok: true, transaction: { ...goodTx, ...tx } });

test("looksLikeJws distinguishes JWS from base64 receipts", () => {
  assert.equal(looksLikeJws("eyJh-_.eyJi_-.sig_-9"), true);
  assert.equal(looksLikeJws("MIIT0gYJKoZIhvcNAQcCoIITwzCCE78CAQ=="), false);
  assert.equal(looksLikeJws("a.b"), false);
  assert.equal(looksLikeJws(undefined), false);
});

test("valid JWS grants once; retry is idempotent and uses legacy-compatible dedupe id", async () => {
  const sb = fakeSupabase();
  const deps = { supabase: sb, verifyJws: okJws() };
  const r1 = await verifyAndGrant(BASE, deps);
  assert.equal(r1.ok, true);
  assert.equal(r1.credits, 20);
  const r2 = await verifyAndGrant(BASE, deps);
  assert.equal(r2.ok, true);
  assert.equal(r2.replayed, true);
  assert.equal(sb.state.rpcs.length, 1);
  assert.deepEqual([...sb.state.ids], ["iap_ios_2000001"]);
});

test("same transaction via legacy receipt after JWS is not granted twice", async () => {
  process.env.APPLE_SHARED_SECRET = "s";
  const sb = fakeSupabase();
  await verifyAndGrant(BASE, { supabase: sb, verifyJws: okJws() });
  const r = await verifyAndGrant(
    { ...BASE, verificationData: "MIIT0gYJKoZIhvc=" },
    { supabase: sb, verifyReceipt: async () => ({ ok: true, transactionId: "2000001" }) }
  );
  assert.equal(r.replayed, true);
  assert.equal(sb.state.rpcs.length, 1);
  delete process.env.APPLE_SHARED_SECRET;
});

for (const [name, tx, error] of [
  ["wrong bundle", { bundleId: "com.evil.app" }, "invalid_transaction"],
  ["wrong product", { productId: "credits_100" }, "product_mismatch"],
  ["revoked", { revocationDate: 1700000000000 }, "invalid_transaction"],
  ["non-consumable", { type: Type.NON_CONSUMABLE }, "invalid_transaction"],
  ["missing transactionId", { transactionId: undefined }, "invalid_transaction"],
]) {
  test(`JWS rejected: ${name}`, async () => {
    const sb = fakeSupabase();
    const r = await verifyAndGrant(BASE, { supabase: sb, verifyJws: okJws(tx) });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.error, error);
    assert.equal(sb.state.rpcs.length, 0);
  });
}

test("JWS verification failure returns invalid_transaction", async () => {
  const r = await verifyAndGrant(BASE, {
    supabase: fakeSupabase(),
    verifyJws: async () => ({ ok: false, reason: "jws_status=1" }),
  });
  assert.equal(r.error, "invalid_transaction");
});

test("legacy base64 receipt still goes to verifyReceipt", async () => {
  process.env.APPLE_SHARED_SECRET = "s";
  const sb = fakeSupabase();
  let called = 0;
  const r = await verifyAndGrant(
    { ...BASE, verificationData: "MIIT0gYJKoZIhvc=" },
    {
      supabase: sb,
      verifyJws: async () => assert.fail("must not use JWS path"),
      verifyReceipt: async () => (called++, { ok: true, transactionId: "9" }),
    }
  );
  assert.equal(r.ok, true);
  assert.equal(called, 1);
  assert.deepEqual([...sb.state.ids], ["iap_ios_9"]);
  delete process.env.APPLE_SHARED_SECRET;
});

test("verifyAppleJws falls back from Production to Sandbox on environment mismatch", async () => {
  const seen = [];
  const makeVerifier = ({ environment }) => ({
    verifyAndDecodeTransaction: async () => {
      seen.push(environment);
      if (environment === Environment.PRODUCTION) {
        throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
      }
      return goodTx;
    },
  });
  const r = await verifyAppleJws({ jws: JWS, bundleId: goodTx.bundleId, appAppleId: 123, makeVerifier });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [Environment.PRODUCTION, Environment.SANDBOX]);
});

test("verifyAppleJws does not fall back on a signature failure and never tries Xcode", async () => {
  const seen = [];
  const makeVerifier = ({ environment }) => ({
    verifyAndDecodeTransaction: async () => {
      seen.push(environment);
      throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    },
  });
  const r = await verifyAppleJws({ jws: JWS, bundleId: "x", appAppleId: 123, makeVerifier });
  assert.equal(r.ok, false);
  assert.deepEqual(seen, [Environment.PRODUCTION]);
});

test("verifyAppleJws without APPLE_APP_ID only tries Sandbox", async () => {
  const seen = [];
  const makeVerifier = ({ environment }) => ({
    verifyAndDecodeTransaction: async () => (seen.push(environment), goodTx),
  });
  const r = await verifyAppleJws({ jws: JWS, bundleId: "x", appAppleId: undefined, makeVerifier });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [Environment.SANDBOX]);
});

test("real SignedDataVerifier loads the committed Apple roots and rejects garbage", async () => {
  const r = await verifyAppleJws({ jws: JWS, bundleId: "com.fotoshop.mobile", appAppleId: 123 });
  assert.equal(r.ok, false);
});
