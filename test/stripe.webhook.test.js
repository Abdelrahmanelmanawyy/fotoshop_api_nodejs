import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import Stripe from "stripe";

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
const { handleWebhookEvent } = await import("../src/domain/stripeService.js");

const SECRET = "whsec_test_secret";

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

const forgedGrant = JSON.stringify({
  id: "evt_forged",
  type: "checkout.session.completed",
  data: { object: { id: "cs_forged", metadata: { uid: "attacker", productId: "credits_100", credits: "100" } } },
});

test("webhook is rejected when STRIPE_WEBHOOK_SECRET is not configured (fail closed)", async () => {
  await assert.rejects(() => handleWebhookEvent(Buffer.from(forgedGrant), undefined), /not configured/);
});

test("webhook without a signature header is rejected", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  await assert.rejects(() => handleWebhookEvent(Buffer.from(forgedGrant), undefined), /signature/);
});

test("webhook with a wrong signature is rejected", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const header = Stripe.webhooks.generateTestHeaderString({ payload: forgedGrant, secret: "whsec_other" });
  await assert.rejects(() => handleWebhookEvent(Buffer.from(forgedGrant), header));
});

test("correctly signed non-grant events are accepted", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.created", data: { object: {} } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const event = await handleWebhookEvent(Buffer.from(payload), header);
  assert.equal(event.type, "payment_intent.created");
});
