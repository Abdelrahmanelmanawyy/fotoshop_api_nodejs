import crypto from 'node:crypto';
import { Router } from 'express';
import express from 'express';
import { getSupabase } from '../../config/supabase.js';
import { getPaytrIframeToken, verifyPaytrCallback } from '../../domain/paytrService.js';
import {
  bundlePriceForPhotos,
  normalizePaperFinish,
  loadPricing,
} from '../../domain/printPricingService.js';
import { parseImageUrls } from '../../core/imageUrls.js';
import {
  validateCouponCode,
  applyCoupon,
  incrementCouponUsage,
} from '../../domain/couponService.js';
import { authenticate, resolveUserId } from '../middleware/auth.js';
import { generalRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * POST /paytr/token
 * Called by Flutter before showing the payment WebView.
 *
 * Pricing is **server-authoritative** — clients never set the amount. The
 * server uses the tier table in `printPricingService.js` so the same code path
 * the Flutter UI previews against is what the customer actually pays.
 */
router.post('/token', authenticate, generalRateLimiter, async (req, res) => {
  try {
    const { paperFinish = 'glossy', boothCode, couponCode } = req.body;

    const who = resolveUserId(req, req.body.uid);
    if (!who.ok) return res.status(who.status).json({ error: who.error });
    const uid = who.uid;

    if (!boothCode) {
      return res.status(400).json({ error: 'boothCode is required' });
    }

    const { imageUrls, error: urlsError } = parseImageUrls(req.body);
    if (urlsError) return res.status(400).json({ error: urlsError });

    const paper = normalizePaperFinish(paperFinish);
    if (!paper) {
      return res.status(400).json({ error: 'invalid paperFinish' });
    }

    const supabase = getSupabase();
    const photoCount = imageUrls.length;

    // Load live pricing from DB (cached for 5 min)
    const pricing = await loadPricing(supabase);
    let amountTry = bundlePriceForPhotos(photoCount, pricing);

    // --- Coupon handling ---
    // Usage is counted in the callback once the payment succeeds, so abandoned
    // checkouts do not burn a limited coupon.
    let couponId = null;
    let discountTry = 0;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const couponResult = await validateCouponCode(supabase, couponCode);
      if (couponResult.error) {
        // Reject so the client can show the error instead of silently charging the full amount.
        return res.status(400).json({ error: couponResult.error });
      }
      const applied = applyCoupon(amountTry, couponResult.coupon);
      discountTry = applied.discountTry;
      amountTry   = applied.discountedAmount;
      couponId    = couponResult.coupon.id;
      console.log(
        `[PayTR] coupon ${couponResult.coupon.code} applied: -₺${discountTry} → ₺${amountTry}`
      );
    }

    const merchantId = process.env.PAYTR_MERCHANT_ID;
    const merchantKey = process.env.PAYTR_MERCHANT_KEY;
    const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
    const testMode = process.env.PAYTR_TEST_MODE || '0';

    if (
      !merchantId ||
      !merchantKey ||
      !merchantSalt ||
      !process.env.PAYTR_CALLBACK_URL
    ) {
      return res
        .status(503)
        .json({ error: 'PayTR credentials not configured on server' });
    }

    const baseUrl = process.env.PAYTR_CALLBACK_URL.replace('/callback', '');
    const orderId = `pr${Date.now().toString(36)}${crypto
      .randomUUID()
      .replace(/-/g, '')
      .slice(0, 8)}`;

    // Persist the order BEFORE asking PayTR for a token: if this row is missing
    // the callback cannot create print jobs, so the customer would pay for nothing.
    // `image_urls` carries the full multi-photo bundle so the callback can fan out
    // into N print_jobs rows; `image_url` keeps the first photo for back-compat.
    const { error: txError } = await supabase.from('payment_transactions').insert({
      id: orderId,
      uid,
      type: 'print',
      status: 'wait',
      amount_try: amountTry,
      booth_code: boothCode,
      image_url: imageUrls[0],
      image_urls: imageUrls,
      copies: photoCount,
      paper_finish: paper,
      coupon_id: couponId,
      discount_try: discountTry,
    });
    if (txError) {
      throw new Error(`payment_transactions insert failed: ${txError.message}`);
    }

    const itemName =
      photoCount === 1
        ? `Baskı (${paper})`
        : `Baskı ×${photoCount} (${paper})`;

    const token = await getPaytrIframeToken({
      merchantId,
      merchantKey,
      merchantSalt,
      orderId,
      email: `${uid}@fotoshop.app`,
      amountTry,
      itemName,
      clientIp: req.ip || '127.0.0.1',
      merchantOkUrl: `${baseUrl}/ok`,
      merchantFailUrl: `${baseUrl}/fail`,
      testMode,
    });

    res.json({ token, orderId, priceTry: amountTry, discountTry });
  } catch (err) {
    console.error('[PayTR] token error:', err.message);
    res.status(500).json({ error: 'payment_init_failed' });
  }
});

/**
 * POST /paytr/callback
 * Server-to-server notification from PayTR.
 *
 * PayTR re-sends the notification until it receives exactly "OK", so:
 *   - answer "OK" only once the outcome is durably stored (or the request is
 *     bogus and must not be retried);
 *   - answer anything else on an internal failure so PayTR retries;
 *   - be idempotent, because the same success can arrive more than once.
 *
 * On success, fans out one `print_jobs` row per image URL — the booth app prints
 * one image per row.
 */
router.post('/callback', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const merchantKey = process.env.PAYTR_MERCHANT_KEY;
    const merchantSalt = process.env.PAYTR_MERCHANT_SALT;

    const valid = verifyPaytrCallback({ merchantKey, merchantSalt, params: req.body });
    if (!valid) {
      console.error('[PayTR] callback hash mismatch — possible tampering');
      return res.send('OK');
    }

    const { merchant_oid, status, total_amount } = req.body;
    const supabase = getSupabase();

    const { data: tx, error: readError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', merchant_oid)
      .maybeSingle();
    if (readError) {
      throw new Error(`payment_transactions read failed: ${readError.message}`);
    }

    if (!tx) {
      console.error(`[PayTR] transaction not found: ${merchant_oid}`);
      return res.send('OK');
    }

    if (tx.status !== 'wait') {
      console.log(`[PayTR] duplicate notification for ${merchant_oid} (status=${tx.status}) — ignored`);
      return res.send('OK');
    }

    if (status !== 'success') {
      await setTransactionStatus(supabase, merchant_oid, 'unpaid');
      console.log(`[PayTR] payment failed: ${merchant_oid}`);
      return res.send('OK');
    }

    // total_amount is in kuruş and covered by the verified hash. It can exceed the
    // order price (installment interest) but must never be below it.
    const paidKurus = Number(total_amount);
    const expectedKurus = Math.round(Number(tx.amount_try) * 100);
    if (!Number.isFinite(paidKurus) || paidKurus < expectedKurus) {
      console.error(
        `[PayTR] amount mismatch for ${merchant_oid}: paid=${total_amount} expected=${expectedKurus} — needs review`
      );
      await setTransactionStatus(supabase, merchant_oid, 'amount_mismatch');
      return res.send('OK');
    }

    // Prefer the image_urls array; fall back to the single image_url column for
    // legacy transactions written before the bundle migration.
    const urls = Array.isArray(tx.image_urls) && tx.image_urls.length > 0
      ? tx.image_urls
      : [tx.image_url].filter(Boolean);

    const rows = urls.map((url, i) => ({
      // First job keeps the merchant_oid for back-compat with status polling
      // that derives the job id from the transaction; later jobs append _i.
      id: urls.length === 1 ? merchant_oid : `${merchant_oid}_${i}`,
      booth_code: tx.booth_code,
      status: 'pending',
      image_url: url,
      user_id: tx.uid,
      copies: 1,
      paper_finish: tx.paper_finish,
      is_paid_by_money: true,
    }));

    // Deterministic ids + ignoreDuplicates make a retry after a partial failure safe.
    const { error: jobsError } = await supabase
      .from('print_jobs')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (jobsError) {
      throw new Error(`print_jobs insert failed: ${jobsError.message}`);
    }

    await setTransactionStatus(supabase, merchant_oid, 'paid');

    if (tx.coupon_id) {
      await incrementCouponUsage(supabase, tx.coupon_id);
    }

    console.log(
      `[PayTR] payment success → ${rows.length} print job(s) created: ${merchant_oid}`
    );
    res.send('OK');
  } catch (err) {
    console.error('[PayTR] callback error (PayTR will retry):', err.message);
    res.status(500).send('RETRY');
  }
});

async function setTransactionStatus(supabase, id, status) {
  const { error } = await supabase
    .from('payment_transactions')
    .update({ status })
    .eq('id', id);
  if (error) {
    throw new Error(`payment_transactions update to ${status} failed: ${error.message}`);
  }
}

/**
 * GET /paytr/status/:orderId
 */
router.get('/status/:orderId', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('status')
      .eq('id', req.params.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ status: data.status, orderId: req.params.orderId });
  } catch (err) {
    console.error('[PayTR] status error:', err.message);
    res.status(500).json({ error: 'status_unavailable' });
  }
});

router.get('/ok', (_, res) =>
  res.send(
    '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Ödeme başarılı!</h2><p>Uygulamaya dönebilirsiniz.</p></body></html>'
  )
);
router.get('/fail', (_, res) =>
  res.send(
    '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>❌ Ödeme başarısız</h2><p>Lütfen tekrar deneyin.</p></body></html>'
  )
);

export default router;
