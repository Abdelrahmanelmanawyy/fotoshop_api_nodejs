import { Router } from 'express';
import express from 'express';
import { initializeFirebase, getFirestore } from '../../config/firebase.js';
import { getPaytrIframeToken, verifyPaytrCallback } from '../../domain/paytrService.js';

const router = Router();

router.use((req, res, next) => {
  try {
    initializeFirebase();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Firebase initialization failed', message: err.message });
  }
});

/**
 * POST /paytr/token
 * Called by Flutter before showing the payment WebView.
 * Body: { uid, copies, paperFinish, imageUrl, boothCode }
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
    const db = getFirestore();

    // Store pending transaction — Node.js callback will update this
    await db.collection('payment_transactions').doc(orderId).set({
      uid,
      type: 'print',
      status: 'wait',
      amountTry: printPriceTry,
      boothCode,
      imageUrl,
      copies,
      paperFinish,
      createdAt: new Date(),
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
    const db = getFirestore();
    const txRef = db.collection('payment_transactions').doc(merchant_oid);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      console.error(`[PayTR] transaction not found: ${merchant_oid}`);
      return res.send('OK');
    }

    const tx = txSnap.data();

    if (status === 'success') {
      // Use orderId as print job doc ID so Flutter can watch it directly
      await db.collection('print_jobs').doc(merchant_oid).set({
        boothCode: tx.boothCode,
        status: 'pending',
        imageUrl: tx.imageUrl,
        userId: tx.uid,
        copies: tx.copies,
        paperFinish: tx.paperFinish,
        isPaidByMoney: true,
        paymentTransactionId: merchant_oid,
        createdAt: new Date(),
      });
      await txRef.update({ status: 'paid' });
      console.log(`[PayTR] payment success → print job created: ${merchant_oid}`);
    } else {
      await txRef.update({ status: 'unpaid' });
      console.log(`[PayTR] payment failed: ${merchant_oid}`);
    }

    res.send('OK');
  } catch (err) {
    console.error('[PayTR] callback error:', err.message);
    res.send('OK'); // always OK to PayTR
  }
});

/**
 * GET /paytr/status/:orderId
 * Flutter polls this to check payment status.
 */
router.get('/status/:orderId', async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('payment_transactions').doc(req.params.orderId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Not found' });
    res.json({ status: snap.data().status, orderId: req.params.orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Simple redirect targets shown in WebView after PayTR payment */
router.get('/ok', (_, res) =>
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Ödeme başarılı!</h2><p>Uygulamaya dönebilirsiniz.</p></body></html>')
);
router.get('/fail', (_, res) =>
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>❌ Ödeme başarısız</h2><p>Lütfen tekrar deneyin.</p></body></html>')
);

export default router;
