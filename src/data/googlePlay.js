import { google } from 'googleapis';

let _androidPublisher = null;

/**
 * Lazily build (and cache) an authenticated Android Publisher client.
 * Credentials come from one of:
 *   - GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  (single-line JSON string)
 *   - GOOGLE_PLAY_SERVICE_ACCOUNT_PATH  (path to a service-account .json file)
 */
async function getAndroidPublisher() {
  if (_androidPublisher) return _androidPublisher;

  const inlineJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const filePath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;

  let auth;
  if (inlineJson && inlineJson.trim().length > 0) {
    let credentials;
    try {
      credentials = JSON.parse(inlineJson);
    } catch (err) {
      throw new Error(
        `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`
      );
    }
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  } else if (filePath && filePath.trim().length > 0) {
    auth = new google.auth.GoogleAuth({
      keyFile: filePath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  } else {
    throw new Error(
      'Google Play credentials missing: set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_SERVICE_ACCOUNT_PATH'
    );
  }

  _androidPublisher = google.androidpublisher({ version: 'v3', auth });
  return _androidPublisher;
}

/**
 * Verify a Google Play purchase token via the Android Publisher API.
 * Reference: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
 *
 * Returns { ok, orderId, consumptionState } on success,
 *         { ok: false, reason } on failure.
 */
export async function verifyGooglePlayPurchase({ packageName, productId, purchaseToken }) {
  if (!packageName || !productId || !purchaseToken) {
    return { ok: false, reason: 'missing_params' };
  }

  const ap = await getAndroidPublisher();

  let data;
  try {
    const resp = await ap.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
    });
    data = resp.data;
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || 'unknown';
    return { ok: false, reason: `google_api_error: ${msg}` };
  }

  // purchaseState: 0 = purchased, 1 = canceled, 2 = pending
  if (data.purchaseState !== 0) {
    return { ok: false, reason: `purchaseState=${data.purchaseState}` };
  }

  return {
    ok: true,
    orderId: data.orderId || null,
    consumptionState: data.consumptionState ?? null,
  };
}
