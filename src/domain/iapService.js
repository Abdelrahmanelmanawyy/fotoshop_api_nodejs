import { getSupabase } from '../config/supabase.js';
import { verifyGooglePlayPurchase } from '../data/googlePlay.js';
import { verifyAppleReceipt } from '../data/appleStore.js';
import { appleJwsConfig, looksLikeJws, verifyAppleJws } from '../data/appleJws.js';
import { Type } from '@apple/app-store-server-library';

/**
 * Credits granted per product ID. Must match Flutter's
 * lib/core/constants/payment_config.dart -> kProductCredits.
 */
const PRODUCT_CREDITS = {
  credits_20: 20,
  credits_50: 50,
  credits_100: 100,
};

/**
 * Verify a Google Play / Apple App Store purchase and grant credits to the user.
 *
 * Flow:
 *   1. Look up the credit amount from the productId (rejects unknown products).
 *   2. If IAP_DEV_MODE=1, skip remote verification (DEV ONLY — trust the client).
 *   3. Otherwise, validate via Google Play Developer API (Android) or Apple's
 *      /verifyReceipt (iOS).
 *   4. Call the Supabase RPC `add_wallet_credits` to atomically grant credits
 *      and log the wallet transaction.
 *
 * Returns { ok: true, credits, externalRef } on success,
 *         { ok: false, status, error, reason? } on failure.
 */
export async function verifyAndGrant(
  { uid, platform, productId, verificationData },
  deps = {}
) {
  const verifyJws = deps.verifyJws || verifyAppleJws;
  const verifyReceipt = deps.verifyReceipt || verifyAppleReceipt;
  const credits = PRODUCT_CREDITS[productId];
  if (!credits) {
    return { ok: false, status: 400, error: 'unknown_product' };
  }

  const devMode = process.env.IAP_DEV_MODE === '1';
  let externalRef = null;

  if (devMode) {
    console.warn(
      `[IAP] DEV MODE — skipping ${platform} verification for ${productId} (uid=${uid})`
    );
    externalRef = `dev_${Date.now()}`;
  } else if (platform === 'android') {
    const packageName = process.env.ANDROID_PACKAGE_NAME;
    if (!packageName) {
      return { ok: false, status: 503, error: 'ANDROID_PACKAGE_NAME not configured' };
    }
    const v = await verifyGooglePlayPurchase({
      packageName,
      productId,
      purchaseToken: verificationData,
    });
    if (!v.ok) {
      return { ok: false, status: 400, error: 'verification_failed', reason: v.reason };
    }
    externalRef = v.orderId;
  } else if (platform === 'ios' && looksLikeJws(verificationData)) {
    // StoreKit 2 signed transaction (iOS 15+). The transactionId equals the
    // legacy receipt transaction_id, so the dedupe id below is shared.
    const cfg = appleJwsConfig();
    const v = await verifyJws({ jws: verificationData, ...cfg });
    if (!v.ok) {
      return { ok: false, status: 400, error: 'invalid_transaction', reason: v.reason };
    }
    const tx = v.transaction || {};
    if (tx.bundleId !== cfg.bundleId) {
      console.error(`[IAP] JWS bundle mismatch (uid=${uid}): ${tx.bundleId}`);
      return { ok: false, status: 400, error: 'invalid_transaction', reason: 'bundle_mismatch' };
    }
    if (tx.productId !== productId || !PRODUCT_CREDITS[tx.productId]) {
      console.error(`[IAP] JWS product mismatch (uid=${uid}): claimed=${productId} signed=${tx.productId}`);
      return { ok: false, status: 400, error: 'product_mismatch' };
    }
    if (tx.type !== Type.CONSUMABLE) {
      return { ok: false, status: 400, error: 'invalid_transaction', reason: 'not_consumable' };
    }
    if (tx.revocationDate) {
      return { ok: false, status: 400, error: 'invalid_transaction', reason: 'revoked' };
    }
    if (!tx.transactionId) {
      return { ok: false, status: 400, error: 'invalid_transaction', reason: 'missing_transaction_id' };
    }
    externalRef = String(tx.transactionId);
  } else if (platform === 'ios') {
    const sharedSecret = process.env.APPLE_SHARED_SECRET;
    if (!sharedSecret) {
      return { ok: false, status: 503, error: 'APPLE_SHARED_SECRET not configured' };
    }
    const v = await verifyReceipt({
      receiptData: verificationData,
      sharedSecret,
      productId,
      bundleId: process.env.IOS_BUNDLE_ID,
    });
    if (!v.ok) {
      return { ok: false, status: 400, error: 'verification_failed', reason: v.reason };
    }
    externalRef = v.transactionId;
  } else {
    return { ok: false, status: 400, error: 'invalid_platform' };
  }

  const supabase = deps.supabase || getSupabase();

  // Replay protection (PRODUCTION_READINESS_PLAN §2.5): a re-sent receipt for
  // an already-granted store transaction must not double-grant. Same
  // payment_transactions PK dedupe the Stripe webhook uses; the store's
  // transaction id is globally unique per purchase.
  const dedupeId = `iap_${platform}_${externalRef}`;
  const { error: dedupeError } = await supabase.from('payment_transactions').insert({
    id: dedupeId,
    uid,
    type: 'iap',
    status: 'paid',
    amount_try: null,
  });
  if (dedupeError) {
    if (dedupeError.code === '23505') {
      console.log(`[IAP] ${dedupeId} already granted — replay ignored`);
      // Idempotent success: the purchase was already credited.
      return { ok: true, credits, externalRef, replayed: true };
    }
    console.error('[IAP] failed to record payment_transaction:', dedupeError);
    return { ok: false, status: 500, error: 'grant_failed' };
  }

  const { error } = await supabase.rpc('add_wallet_credits', {
    p_uid: uid,
    p_delta: credits,
    p_title: 'Kredi Satın Alındı',
    p_subtitle: `${credits} kredi eklendi • ${productId}`,
    p_type: 'purchase', // real money — distinguishes from free 'gift' credits
  });
  if (error) {
    // Release the dedupe row so the client's retry can grant cleanly.
    await supabase.from('payment_transactions').delete().eq('id', dedupeId);
    console.error('[IAP] Supabase RPC error:', error);
    return { ok: false, status: 500, error: 'grant_failed' };
  }

  console.log(
    `[IAP] Granted ${credits} credits to ${uid} (${platform}/${productId}, ref=${externalRef})`
  );
  return { ok: true, credits, externalRef };
}
