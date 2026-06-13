/**
 * Coupon routes:
 *
 * POST /coupon/validate     — pre-checkout preview, no side-effects
 * POST /coupon/redeem-free  — records a 100% coupon use that bypassed payment
 */
import { Router } from 'express';
import { getSupabase } from '../../config/supabase.js';
import { validateCouponCode, applyCoupon, incrementCouponUsage } from '../../domain/couponService.js';

const router = Router();

/**
 * POST /coupon/validate
 *
 * Body:   { couponCode: string, amountTry: number }
 * 200:    { valid: true, discountedAmount, discountTry, discountLabel, couponCode }
 * 200:    { valid: false, error: string }
 */
router.post('/validate', async (req, res) => {
  const { couponCode, amountTry } = req.body ?? {};

  if (!couponCode) {
    return res.status(400).json({ valid: false, error: 'couponCode is required' });
  }

  const amount = parseFloat(amountTry);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ valid: false, error: 'amountTry must be a positive number' });
  }

  const supabase = getSupabase();
  const result = await validateCouponCode(supabase, couponCode);

  if (result.error) {
    return res.json({ valid: false, error: result.error });
  }

  const { discountedAmount, discountTry, discountLabel } = applyCoupon(amount, result.coupon);

  return res.json({
    valid: true,
    couponCode: result.coupon.code,
    discountedAmount,
    discountTry,
    discountLabel,
  });
});

/**
 * POST /coupon/redeem-free
 *
 * Called by the Flutter app when a 100% discount coupon enables a free print
 * (bypassing the PayTR payment flow entirely). Records the coupon usage so the
 * admin dashboard can track it.
 *
 * Body:   { couponCode: string, originalAmountTry: number, boothCode: string, uid: string }
 * 200:    { success: true }
 * 400:    { error: string }
 */
router.post('/redeem-free', async (req, res) => {
  const { couponCode, originalAmountTry, boothCode, uid } = req.body ?? {};

  if (!couponCode || !uid) {
    return res.status(400).json({ error: 'couponCode and uid are required' });
  }

  const originalAmount = parseFloat(originalAmountTry);
  if (!Number.isFinite(originalAmount) || originalAmount < 0) {
    return res.status(400).json({ error: 'originalAmountTry must be a non-negative number' });
  }

  const supabase = getSupabase();

  // Validate the coupon is still active and usable
  const result = await validateCouponCode(supabase, couponCode);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const coupon = result.coupon;

  // Build a unique transaction ID for this free redemption
  const txId = `free_${uid.replace(/-/g, '').slice(0, 8)}_${Date.now()}`;

  // Insert a payment_transactions row with final price = 0 so analytics can see it
  const { error: insertErr } = await supabase.from('payment_transactions').insert({
    id: txId,
    uid,
    type: 'print',
    status: 'success',
    amount_try: 0,
    discount_try: originalAmount,
    coupon_id: coupon.id,
    booth_code: boothCode || null,
  });

  if (insertErr) {
    console.error('[coupon/redeem-free] insert error:', insertErr.message);
    // Non-fatal — still increment so count is correct
  }

  // Increment the coupon usage counter
  await incrementCouponUsage(supabase, coupon.id);

  return res.json({ success: true });
});

export default router;
