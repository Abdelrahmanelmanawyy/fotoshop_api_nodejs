import assert from "node:assert/strict";
import test from "node:test";

import { createOrderService, resolveEditPrompt } from "../src/domain/orderService.js";

test("resolveEditPrompt prefers user prompt over preset", () => {
  assert.equal(
    resolveEditPrompt({ prompt: "  vintage look  ", preset: "portrait_enhance" }),
    "vintage look"
  );
});

test("resolveEditPrompt falls back to preset mapping when prompt empty", () => {
  const p = resolveEditPrompt({ preset: "portrait_enhance" });
  assert.ok(p.includes("portrait") || p.includes("enhance"));
});

test("processOrder returns aggregated results when one photo fails", async () => {
  const calls = { replicate: 0, upload: 0 };

  const svc = createOrderService({
    async getOrder() {
      return {
        photos: [
          { photo_id: "A", input_url: "https://in/a", user_id: "u1", preset: "vintage" },
          { photo_id: "B", input_url: "https://in/b", user_id: "u1", preset: "vintage" },
        ],
      };
    },
    async runImageEdit({ inputImageUrl }) {
      calls.replicate++;
      if (inputImageUrl.includes("/b")) {
        throw new Error("replicate boom");
      }
      return "https://out/replicate.jpg";
    },
    runGptImageEdit: async () => {
      throw new Error("should not run");
    },
    isOpenAiDirectModel: () => false,
    async uploadImageFromUrl() {
      calls.upload++;
      return "https://storage/out.jpg";
    },
    async updatePhotoOutput() {},
  });

  const out = await svc.processOrder("ORD_1", "orders");

  assert.equal(out.order_id, "ORD_1");
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].success, true);
  assert.equal(out.results[1].success, false);
  assert.equal(out.results[1].error, "replicate boom");
  assert.equal(calls.replicate, 2);
  assert.equal(calls.upload, 1);
});

test("processOrder refunds + marks failed when ALL photos fail", async () => {
  const calls = { refund: 0, statuses: [] };

  const svc = createOrderService({
    async getOrder() {
      return {
        photos: [{ photo_id: "A", input_url: "https://in/a", user_id: "u1" }],
      };
    },
    async runImageEdit() {
      throw new Error("replicate down");
    },
    runGptImageEdit: async () => {
      throw new Error("should not run");
    },
    isOpenAiDirectModel: () => false,
    async uploadImageFromUrl() {
      throw new Error("should not run");
    },
    async updatePhotoOutput() {},
    async setOrderStatus(orderId, status) {
      calls.statuses.push(status);
    },
    async refundOrder() {
      calls.refund++;
      return true;
    },
  });

  const out = await svc.processOrder("ORD_FAIL", "orders");

  assert.equal(out.results[0].success, false);
  assert.equal(calls.refund, 1, "should refund exactly once on total failure");
  assert.ok(calls.statuses.includes("processing"), "marks processing at start");
});

test("processOrder skips photos that already have output (idempotent re-run)", async () => {
  let replicateCalls = 0;
  const svc = createOrderService({
    async getOrder() {
      return {
        photos: [
          { photo_id: "A", input_url: "https://in/a", user_id: "u1", output_url: "https://done/a.jpg" },
          { photo_id: "B", input_url: "https://in/b", user_id: "u1" },
        ],
      };
    },
    async runImageEdit() {
      replicateCalls++;
      return "https://out/x.jpg";
    },
    runGptImageEdit: async () => "https://out/y.jpg",
    isOpenAiDirectModel: () => false,
    async uploadImageFromUrl() {
      return "https://storage/out.jpg";
    },
    async updatePhotoOutput() {},
    async setOrderStatus() {},
    async refundOrder() {
      return true;
    },
  });

  const out = await svc.processOrder("ORD_RE", "orders");

  assert.equal(replicateCalls, 1, "only the not-yet-done photo is regenerated");
  assert.equal(out.results.filter((r) => r.success).length, 2);
});

test("processOrder throws when order missing", async () => {
  const svc = createOrderService({
    async getOrder() {
      return null;
    },
    async runImageEdit() {
      throw new Error("should not run");
    },
    runGptImageEdit: async () => {
      throw new Error("should not run");
    },
    isOpenAiDirectModel: () => false,
    async uploadImageFromUrl() {
      throw new Error("should not run");
    },
    async updatePhotoOutput() {},
  });

  await assert.rejects(() => svc.processOrder("missing", "orders"), /not found/);
});
