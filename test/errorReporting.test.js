import assert from "node:assert/strict";
import { test } from "node:test";

import {
  scrubEvent,
  initErrorReporting,
  isErrorReportingEnabled,
  reportError,
  flushErrorReporting,
} from "../src/core/errorReporting.js";

test("scrubEvent strips auth headers, cookies and request bodies", () => {
  const event = scrubEvent({
    request: {
      url: "https://api.fotoshopapp.xyz/iap/verify",
      data: { receipt: "secret-receipt" },
      cookies: { a: "b" },
      headers: {
        Authorization: "Bearer jwt",
        cookie: "s=1",
        "Stripe-Signature": "t=1,v1=abc",
        "content-type": "application/json",
      },
    },
    user: { id: "u1", ip_address: "1.2.3.4", email: "a@b.c" },
  });
  assert.equal(event.request.data, undefined);
  assert.equal(event.request.cookies, undefined);
  assert.deepEqual(event.request.headers, { "content-type": "application/json" });
  assert.deepEqual(event.user, { id: "u1" });
  assert.equal(event.request.url, "https://api.fotoshopapp.xyz/iap/verify");
});

test("scrubEvent tolerates events without a request", () => {
  assert.deepEqual(scrubEvent({ message: "x" }), { message: "x" });
});

test("without SENTRY_DSN nothing is initialised and reporting is a no-op", async () => {
  assert.equal(initErrorReporting({}), false);
  assert.equal(initErrorReporting({ SENTRY_DSN: "  " }), false);
  assert.equal(isErrorReportingEnabled(), false);
  reportError(new Error("ignored"), { area: "test" });
  await flushErrorReporting(10);
});
