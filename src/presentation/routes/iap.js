import { Router } from 'express';
import { verifyAndGrant } from '../../domain/iapService.js';
import { resolveUserId } from '../middleware/auth.js';

const router = Router();
const ALLOWED_PLATFORMS = new Set(['android', 'ios']);

/**
 * POST /iap/verify
 * Body: { platform: 'android'|'ios', productId, verificationData, uid? }
 *  - Android: verificationData = purchase token
 *             (purchase.verificationData.serverVerificationData)
 *  - iOS:     verificationData = base64-encoded App Store receipt-data
 *             (purchase.verificationData.serverVerificationData)
 *
 * Validates the purchase with Google/Apple (or skips if IAP_DEV_MODE=1)
 * and grants credits via the Supabase RPC `add_wallet_credits` to the
 * authenticated user (body `uid` is only honoured in soft-auth mode).
 */
router.post('/verify', async (req, res) => {
  try {
    const { platform, productId, verificationData } = req.body || {};

    const who = resolveUserId(req, req.body?.uid);
    if (!who.ok) return res.status(who.status).json({ error: who.error });

    if (!platform || !productId || !verificationData) {
      return res.status(400).json({
        error: 'platform, productId, verificationData are required',
      });
    }
    if (!ALLOWED_PLATFORMS.has(platform)) {
      return res.status(400).json({ error: 'platform must be android or ios' });
    }
    if (typeof verificationData !== 'string') {
      return res.status(400).json({ error: 'verificationData must be a string' });
    }

    console.log(
      `[API] POST /iap/verify uid=${who.uid} platform=${platform} product=${productId}`
    );

    const result = await verifyAndGrant({ uid: who.uid, platform, productId, verificationData });
    if (!result.ok) {
      return res
        .status(result.status || 400)
        .json({ error: result.error, reason: result.reason });
    }
    res.json({ ok: true, credits: result.credits, ref: result.externalRef });
  } catch (err) {
    console.error('[IAP] verify error:', err);
    res.status(500).json({ error: 'verification_error' });
  }
});

export default router;
