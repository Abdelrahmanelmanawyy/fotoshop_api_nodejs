import crypto from 'node:crypto';
import { Router } from 'express';
import express from 'express';
import { getSupabase } from '../../config/supabase.js';
import { getPaytrIframeToken, verifyPaytrCallback } from '../../domain/paytrService.js';
import {
  MAX_PHOTOS_PER_ORDER,
  bundlePriceForPhotos,
  normalizePaperFinish,
  loadPricing,
} from '../../domain/printPricingService.js';
import {
  validateCouponCode,
  applyCoupon,
  incrementCouponUsage,
} from '../../domain/couponService.js';

const router = Router();

router.use((req, res, next) => {
  try {
    getSupabase();
    next();
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Supabase initialization failed', message: err.message });
  }
});

/**
 * Validate the incoming image URL(s). Accepts either:
 *   - `imageUrls`: string[] (preferred — multi-photo bundles)
 *   - `imageUrl`:  string   (legacy — single photo)
 * Returns { imageUrls } as a normalized array, or { error } on failure.
 *
 * @param {{ imageUrl?: unknown, imageUrls?: unknown }} body
 */
function parseImageUrls(body) {
  let raw;
  if (Array.isArray(body.imageUrls)) {
    raw = body.imageUrls;
  } else if (typeof body.imageUrl === 'string') {
    raw = [body.imageUrl];
  } else {
    return { error: 'imageUrl or imageUrls is required' };
  }

  if (raw.length === 0) {
    return { error: 'imageUrls cannot be empty' };
  }
  if (raw.length > MAX_PHOTOS_PER_ORDER) {
    return { error: `at most ${MAX_PHOTOS_PER_ORDER} photos per order` };
  }

  for (const url of raw) {
    if (typeof url !== 'string') {
      return { error: 'each image URL must be a string' };
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        return { error: 'image URLs must use https' };
      }
    } catch {
      return { error: 'invalid image URL' };
    }
  }

  return { imageUrls: raw };
}

/**
 * POST /paytr/token
 * Called by Flutter before showing the payment WebView.
 *
 * Pricing is **server-authoritative** — clients never set the amount. The
 * server uses the tier table in `printPricingService.js` so the same code path
 * the Flutter UI previews against is what the customer actually pays.
 */
router.post('/token', async (req, res) => {
  try {
    const { uid, paperFinish = 'glossy', boothCode, couponCode } = req.body;

    if (!uid || !boothCode) {
      return res
        .status(400)
        .json({ error: 'uid and boothCode are required' });
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
    let couponId = null;
    let discountTry = 0;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const couponResult = await validateCouponCode(supabase, couponCode);
      if (!couponResult.error) {
        const applied = applyCoupon(amountTry, couponResult.coupon);
        discountTry = applied.discountTry;
        amountTry   = applied.discountedAmount;
        couponId    = couponResult.coupon.id;
        console.log(
          `[PayTR] coupon ${couponResult.coupon.code} applied: -₺${discountTry} → ₺${amountTry}`
        );
      } else {
        // Invalid coupon — reject so the client can show the error instead of
        // silently charging the full amount.
        return res.status(400).json({ error: couponResult.error });
      }
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

    // Persist the order. `image_urls` carries the full multi-photo bundle so
    // the callback can fan out into N print_jobs rows. `image_url` keeps the
    // first photo populated for back-compat with anything reading the old
    // single-photo column.
    await supabase.from('payment_transactions').insert({
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

    // Increment coupon usage only after the DB row is successfully written.
    if (couponId) {
      await incrementCouponUsage(supabase, couponId);
    }

    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

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
      clientIp,
      merchantOkUrl: `${baseUrl}/ok`,
      merchantFailUrl: `${baseUrl}/fail`,
      testMode,
    });

    res.json({ token, orderId, priceTry: amountTry, discountTry });
  } catch (err) {
    console.error('[PayTR] token error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /paytr/callback
 * Server-to-server notification from PayTR. Must always respond "OK".
 *
 * On success, fans out one `print_jobs` row per image URL — the Python
 * listener already prints one image per row, so no listener change needed.
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

    const { merchant_oid, status } = req.body;
    const supabase = getSupabase();

    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', merchant_oid)
      .maybeSingle();

    if (!tx) {
      console.error(`[PayTR] transaction not found: ${merchant_oid}`);
      return res.send('OK');
    }

    if (status === 'success') {
      // Prefer the new image_urls array; fall back to the single image_url
      // column for legacy transactions written before the bundle migration.
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

      await supabase.from('print_jobs').insert(rows);
      await supabase
        .from('payment_transactions')
        .update({ status: 'paid' })
        .eq('id', merchant_oid);
      console.log(
        `[PayTR] payment success → ${rows.length} print job(s) created: ${merchant_oid}`
      );
    } else {
      await supabase
        .from('payment_transactions')
        .update({ status: 'unpaid' })
        .eq('id', merchant_oid);
      console.log(`[PayTR] payment failed: ${merchant_oid}`);
    }

    res.send('OK');
  } catch (err) {
    console.error('[PayTR] callback error:', err.message);
    res.send('OK');
  }
});

/**
 * GET /paytr/status/:orderId
 */
router.get('/status/:orderId', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('payment_transactions')
      .select('status')
      .eq('id', req.params.orderId)
      .maybeSingle();

    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ status: data.status, orderId: req.params.orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
