import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/node";

/**
 * Optional crash reporting (Sentry). Inert unless SENTRY_DSN is set: no init,
 * no network calls, and reportError()/flushErrorReporting() become no-ops.
 */

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "stripe-signature",
  "x-goog-signature",
]);

/** Remove credentials and request bodies (payment / IAP receipt data) from an event. */
export function scrubEvent(event) {
  const req = event?.request;
  if (req) {
    delete req.data; // request bodies: receipts, card/payment fields
    delete req.cookies;
    if (req.headers && typeof req.headers === "object") {
      for (const key of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) delete req.headers[key];
      }
    }
  }
  if (event?.user) {
    delete event.user.ip_address;
    delete event.user.email;
  }
  return event;
}

// Console breadcrumbs would copy our log lines (which can mention order/user ids) into events;
// the process-level integrations are disabled because index.js reports those errors itself.
const DISABLED_INTEGRATIONS = new Set(["Console", "OnUncaughtException", "OnUnhandledRejection"]);

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return pkg.version;
  } catch {
    return undefined;
  }
}

/** Initialise Sentry when SENTRY_DSN is set. Returns true if reporting is active. */
export function initErrorReporting(env = process.env) {
  const dsn = (env.SENTRY_DSN ?? "").trim();
  if (!dsn) return false;
  try {
    const version = readVersion();
    Sentry.init({
      dsn,
      environment: (env.SENTRY_ENVIRONMENT ?? "").trim() || "production",
      release: version ? `fotoshop-api@${version}` : undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      integrations: (defaults) => defaults.filter((i) => !DISABLED_INTEGRATIONS.has(i.name)),
      beforeSend: scrubEvent,
    });
    console.log("[Sentry] Crash reporting enabled");
    return true;
  } catch (e) {
    console.error("[Sentry] init failed:", e?.message ?? e);
    return false;
  }
}

export function isErrorReportingEnabled() {
  return Sentry.isEnabled();
}

/** Report an error. No-op when Sentry is not configured. Never throws. */
export function reportError(err, context) {
  if (!Sentry.isEnabled()) return;
  try {
    Sentry.captureException(err, context ? { tags: context } : undefined);
  } catch {
    /* reporting must never break the request path */
  }
}

/** Wait (bounded) for queued events to be sent, e.g. before process.exit. */
export async function flushErrorReporting(timeoutMs = 2000) {
  if (!Sentry.isEnabled()) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* ignore */
  }
}
