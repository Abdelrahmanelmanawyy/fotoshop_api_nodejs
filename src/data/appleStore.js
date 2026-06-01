const PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const REQUEST_TIMEOUT_MS = 15000;

async function postReceipt(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return res.json();
}

/**
 * Verify a base64 App Store receipt via Apple's /verifyReceipt endpoint.
 * Calls production first; on Apple status 21007 (sandbox receipt) retries sandbox.
 *
 * Reference: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
 *
 * Returns { ok, transactionId, originalTransactionId } on success,
 *         { ok: false, reason } on failure.
 */
export async function verifyAppleReceipt({
  receiptData,
  sharedSecret,
  productId,
  bundleId,
}) {
  if (!receiptData || !sharedSecret || !productId) {
    return { ok: false, reason: 'missing_params' };
  }

  const body = {
    'receipt-data': receiptData,
    password: sharedSecret,
    'exclude-old-transactions': true,
  };

  let result;
  try {
    result = await postReceipt(PROD_URL, body);
    if (result.status === 21007) {
      result = await postReceipt(SANDBOX_URL, body);
    }
  } catch (err) {
    return { ok: false, reason: `apple_request_error: ${err.message}` };
  }

  if (result.status !== 0) {
    return { ok: false, reason: `apple_status=${result.status}` };
  }

  if (bundleId && result.receipt?.bundle_id && result.receipt.bundle_id !== bundleId) {
    return { ok: false, reason: 'bundle_id_mismatch' };
  }

  // Prefer latest_receipt_info (autoRenewable / refreshed), then receipt.in_app.
  const candidates = [
    ...(Array.isArray(result.latest_receipt_info) ? result.latest_receipt_info : []),
    ...(Array.isArray(result.receipt?.in_app) ? result.receipt.in_app : []),
  ];

  const tx = candidates.find((t) => t.product_id === productId);
  if (!tx) {
    return { ok: false, reason: 'product_not_found_in_receipt' };
  }

  return {
    ok: true,
    transactionId: tx.transaction_id,
    originalTransactionId: tx.original_transaction_id,
  };
}
