import assert from "node:assert/strict";
import test from "node:test";

import { createOrderService } from "../src/domain/orderService.js";

function makeService(overrides = {}) {
  const calls = { model: 0, statuses: [], claims: [] };
  const svc = createOrderService({
    async getOrder() {
      return { photos: [{ photo_id: "A", input_url: "https://in/a", user_id: "u1" }] };
    },
    async runImageEdit() {
      calls.model++;
      return "https://out/a.jpg";
    },
    runGptImageEdit: async () => {
      throw new Error("should not run");
    },
    isOpenAiDirectModel: () => false,
    uploadImageFromUrl: async () => "https://storage/a.jpg",
    updatePhotoOutput: async () => {},
    setOrderStatus: async (_id, status, err) => {
      calls.statuses.push(err ? `${status}:${err}` : status);
    },
    claimOrder: async (id, opts) => {
      calls.claims.push({ id, ...opts });
      return true;
    },
    processingStaleMs: 1234,
    ...overrides,
  });
  return { svc, calls };
}

test("processOrder does not call the model for an order nobody paid for", async () => {
  const { svc, calls } = makeService({ isOrderPaid: async () => false });

  const out = await svc.processOrder("ORD_UNPAID");

  assert.equal(out.skipped, "unpaid");
  assert.equal(calls.model, 0);
  assert.equal(calls.claims.length, 0);
  assert.deepEqual(calls.statuses, ["failed:unpaid"]);
});

test("processOrder skips when another worker already claimed the order", async () => {
  const { svc, calls } = makeService({
    isOrderPaid: async () => true,
    claimOrder: async () => false,
  });

  const out = await svc.processOrder("ORD_BUSY");

  assert.equal(out.skipped, "already_claimed");
  assert.equal(calls.model, 0);
  assert.deepEqual(calls.statuses, []);
});

test("processOrder claims with the configured stale window, then processes", async () => {
  const { svc, calls } = makeService({ isOrderPaid: async () => true });

  const out = await svc.processOrder("ORD_OK");

  assert.deepEqual(calls.claims, [{ id: "ORD_OK", staleMs: 1234 }]);
  assert.equal(calls.model, 1);
  assert.equal(out.results[0].success, true);
  assert.deepEqual(calls.statuses, ["processing", "completed"]);
});

test("two concurrent triggers for one order run the model once", async () => {
  let claimed = false;
  const { svc, calls } = makeService({
    isOrderPaid: async () => true,
    // Mirrors the conditional UPDATE: only the first caller flips pending → processing.
    claimOrder: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  });

  const [a, b] = await Promise.all([svc.processOrder("ORD_X"), svc.processOrder("ORD_X")]);

  assert.equal(calls.model, 1);
  assert.equal([a, b].filter((r) => r.skipped === "already_claimed").length, 1);
});
