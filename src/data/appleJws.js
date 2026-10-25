import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';

/**
 * StoreKit 2 (iOS 15+): serverVerificationData is a JWS signed transaction
 * (three base64url segments). StoreKit 1 sends a base64 receipt instead.
 */
const JWS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function looksLikeJws(value) {
  return typeof value === 'string' && JWS_RE.test(value);
}

const CERT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'certs',
  'apple'
);

let rootCerts = null;
function loadRootCerts() {
  if (!rootCerts) {
    rootCerts = readdirSync(CERT_DIR)
      .filter((f) => f.endsWith('.cer'))
      .map((f) => readFileSync(path.join(CERT_DIR, f)));
  }
  return rootCerts;
}

export function appleJwsConfig() {
  const appId = Number(process.env.APPLE_APP_ID);
  return {
    bundleId: process.env.APPLE_BUNDLE_ID || process.env.IOS_BUNDLE_ID || 'com.fotoshop.mobile',
    appAppleId: Number.isInteger(appId) && appId > 0 ? appId : undefined,
  };
}

function defaultMakeVerifier({ environment, bundleId, appAppleId }) {
  return new SignedDataVerifier(loadRootCerts(), true, environment, bundleId, appAppleId);
}

/**
 * Verify a StoreKit 2 signed transaction. Tries Production first (needs
 * APPLE_APP_ID), then Sandbox when Apple reports an environment mismatch
 * (App Review / TestFlight). Xcode / LocalTesting are never accepted.
 *
 * `makeVerifier({ environment, bundleId, appAppleId })` is injectable for tests
 * and must return an object with `verifyAndDecodeTransaction(jws)`.
 *
 * Returns { ok: true, transaction, environment } or { ok: false, reason }.
 */
export async function verifyAppleJws({
  jws,
  bundleId,
  appAppleId,
  makeVerifier = defaultMakeVerifier,
}) {
  const envs = [];
  if (appAppleId) envs.push(Environment.PRODUCTION);
  else console.warn('[IAP] APPLE_APP_ID not set — only Sandbox JWS verification is possible');
  envs.push(Environment.SANDBOX);

  let lastReason = 'verification_failed';
  for (const environment of envs) {
    try {
      const verifier = makeVerifier({ environment, bundleId, appAppleId });
      const transaction = await verifier.verifyAndDecodeTransaction(jws);
      return { ok: true, transaction, environment };
    } catch (err) {
      const status = err instanceof VerificationException ? err.status : undefined;
      if (status === VerificationStatus.INVALID_ENVIRONMENT) {
        lastReason = 'environment_mismatch';
        continue; // try the next environment
      }
      lastReason = `jws_status=${status ?? 'error'}`;
      console.error(`[IAP] JWS verification failed (${environment}): ${lastReason} ${err?.message || ''}`);
      return { ok: false, reason: lastReason };
    }
  }
  return { ok: false, reason: lastReason };
}
