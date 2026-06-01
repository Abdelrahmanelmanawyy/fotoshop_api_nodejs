import { getSupabase } from '../config/supabase.js';
import { verifyGooglePlayPurchase } from '../data/googlePlay.js';
import { verifyAppleReceipt } from '../data/appleStore.js';

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
export async function verifyAndGrant({ uid, platform, productId, verificationData }) {
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
  } else if (platform === 'ios') {
    const sharedSecret = process.env.APPLE_SHARED_SECRET;
    if (!sharedSecret) {
      return { ok: false, status: 503, error: 'APPLE_SHARED_SECRET not configured' };
    }
    const v = await verifyAppleReceipt({
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

  const supabase = getSupabase();
  const { error } = await supabase.rpc('add_wallet_credits', {
    p_uid: uid,
    p_delta: credits,
    p_title: 'Kredi Satın Alındı',
    p_subtitle: `${credits} kredi eklendi • ${productId}`,
  });
  if (error) {
    console.error('[IAP] Supabase RPC error:', error);
    return { ok: false, status: 500, error: 'grant_failed' };
  }

  console.log(
    `[IAP] Granted ${credits} credits to ${uid} (${platform}/${productId}, ref=${externalRef})`
  );
  return { ok: true, credits, externalRef };
}
