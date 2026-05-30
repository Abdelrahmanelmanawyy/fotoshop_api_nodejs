import { Router } from 'express';
import express from 'express';
import { getSupabase } from '../../config/supabase.js';
import { getPaytrIframeToken, verifyPaytrCallback } from '../../domain/paytrService.js';

const router = Router();

router.use((req, res, next) => {
  try {
    getSupabase();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Supabase initialization failed', message: err.message });
  }
});

/**
 * POST /paytr/token
 * Called by Flutter before showing the payment WebView.
 */
router.post('/token', async (req, res) => {
  try {
    const { uid, copies = 1, paperFinish = 'glossy', imageUrl, boothCode } = req.body;

    if (!uid || !imageUrl || !boothCode) {
      return res.status(400).json({ error: 'uid, imageUrl and boothCode are required' });
    }

    const merchantId = process.env.PAYTR_MERCHANT_ID;
    const merchantKey = process.env.PAYTR_MERCHANT_KEY;
    const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
    const testMode = process.env.PAYTR_TEST_MODE || '0';
    const baseUrl = process.env.PAYTR_CALLBACK_URL.replace('/callback', '');
    const printPriceTry = parseFloat(process.env.PRINT_PRICE_TRY || '49.99');

    if (!merchantId || !merchantKey || !merchantSalt || !process.env.PAYTR_CALLBACK_URL) {
      return res.status(503).json({ error: 'PayTR credentials not configured on server' });
    }

    const orderId = `pr${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const supabase = getSupabase();

    await supabase.from('payment_transactions').insert({
      id: orderId,
      uid,
      type: 'print',
      status: 'wait',
      amount_try: printPriceTry,
      booth_code: boothCode,
      image_url: imageUrl,
      copies,
      paper_finish: paperFinish,
    });

    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const token = await getPaytrIframeToken({
      merchantId,
      merchantKey,
      merchantSalt,
      orderId,
      email: `${uid}@fotoshop.app`,
      amountTry: printPriceTry,
      itemName: `Baskı ×${copies} (${paperFinish})`,
      clientIp,
      merchantOkUrl: `${baseUrl}/ok`,
      merchantFailUrl: `${baseUrl}/fail`,
      testMode,
    });

    res.json({ token, orderId, priceTry: printPriceTry });
  } catch (err) {
    console.error('[PayTR] token error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /paytr/callback
 * Server-to-server notification from PayTR. Must always respond "OK".
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
      await supabase.from('print_jobs').insert({
        id: merchant_oid,
        booth_code: tx.booth_code,
        status: 'pending',
        image_url: tx.image_url,
        user_id: tx.uid,
        copies: tx.copies,
        paper_finish: tx.paper_finish,
        is_paid_by_money: true,
      });
      await supabase
        .from('payment_transactions')
        .update({ status: 'paid' })
        .eq('id', merchant_oid);
      console.log(`[PayTR] payment success → print job created: ${merchant_oid}`);
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
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Ödeme başarılı!</h2><p>Uygulamaya dönebilirsiniz.</p></body></html>')
);
router.get('/fail', (_, res) =>
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>❌ Ödeme başarısız</h2><p>Lütfen tekrar deneyin.</p></body></html>')
);

export default router;
