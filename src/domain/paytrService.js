import crypto from 'crypto';

/**
 * Request a PayTR iFrame token.
 * Returns the token string on success, throws on failure.
 */
export async function getPaytrIframeToken({
  merchantId,
  merchantKey,
  merchantSalt,
  orderId,
  email,
  amountTry,
  itemName,
  clientIp,
  merchantOkUrl,
  merchantFailUrl,
  testMode = '0',
}) {
  const paymentAmount = Math.round(amountTry * 100); // kuruş
  const userBasket = Buffer.from(
    JSON.stringify([[itemName, amountTry.toFixed(2), 1]])
  ).toString('base64');

  const hashStr =
    `${merchantId}${clientIp}${orderId}${email}` +
    `${paymentAmount}${userBasket}00TL${testMode}`;

  const paytrToken = crypto
    .createHmac('sha256', `${merchantKey}${merchantSalt}`)
    .update(hashStr)
    .digest('base64');

  const params = new URLSearchParams({
    merchant_id: merchantId,
    user_ip: clientIp,
    merchant_oid: orderId,
    email,
    payment_amount: String(paymentAmount),
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: '1',
    no_installment: '0',
    max_installment: '0',
    user_name: email,
    user_address: 'N/A',
    user_phone: 'N/A',
    merchant_ok_url: merchantOkUrl,
    merchant_fail_url: merchantFailUrl,
    currency: 'TL',
    test_mode: testMode,
    lang: 'tr',
  });

  const response = await fetch('https://www.paytr.com/odeme/api/get-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();

  if (data.status !== 'success') {
    throw new Error(data.reason || 'PayTR token request failed');
  }

  return data.token;
}

/**
 * Verify the HMAC hash in a PayTR server-to-server callback.
 */
export function verifyPaytrCallback({ merchantKey, merchantSalt, params }) {
  const { merchant_oid, status, total_amount, hash } = params;
  const hashStr = `${merchant_oid}${merchantSalt}${status}${total_amount}`;
  const expected = crypto
    .createHmac('sha256', merchantKey)
    .update(hashStr)
    .digest('base64');
  return expected === hash;
}
