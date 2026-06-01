import { Router } from 'express';
import { getSupabase } from '../../config/supabase.js';
import { verifyAndGrant } from '../../domain/iapService.js';

const router = Router();
const ALLOWED_PLATFORMS = new Set(['android', 'ios']);

router.use((req, res, next) => {
  try {
    getSupabase();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Supabase initialization failed', message: err.message });
  }
});

/**
 * POST /iap/verify
 * Body: { uid, platform: 'android'|'ios', productId, verificationData }
 *  - Android: verificationData = purchase token
 *             (purchase.verificationData.serverVerificationData)
 *  - iOS:     verificationData = base64-encoded App Store receipt-data
 *             (purchase.verificationData.serverVerificationData)
 *
 * Validates the purchase with Google/Apple (or skips if IAP_DEV_MODE=1)
 * and grants credits via the Supabase RPC `add_wallet_credits`.
 */
router.post('/verify', async (req, res) => {
  try {
    const { uid, platform, productId, verificationData } = req.body || {};

    if (!uid || !platform || !productId || !verificationData) {
      return res.status(400).json({
        error: 'uid, platform, productId, verificationData are required',
      });
    }
    if (!ALLOWED_PLATFORMS.has(platform)) {
      return res.status(400).json({ error: 'platform must be android or ios' });
    }
    if (typeof verificationData !== 'string') {
      return res.status(400).json({ error: 'verificationData must be a string' });
    }

    console.log(
      `[API] POST /iap/verify uid=${uid} platform=${platform} product=${productId}`
    );

    const result = await verifyAndGrant({ uid, platform, productId, verificationData });
    if (!result.ok) {
      return res
        .status(result.status || 400)
        .json({ error: result.error, reason: result.reason });
    }
    res.json({ ok: true, credits: result.credits, ref: result.externalRef });
  } catch (err) {
    console.error('[IAP] verify error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
