/**
 * POST /coupon/validate
 *
 * Pre-checkout coupon preview — Flutter calls this when the user types a code
 * so the UI can show the discount before opening the PayTR WebView.
 *
 * This endpoint does NOT increment used_count; that happens in /paytr/token
 * when the payment is actually initiated.
 *
 * Body:   { couponCode: string, amountTry: number }
 * 200:    { valid: true, discountedAmount, discountTry, discountLabel, couponCode }
 * 200:    { valid: false, error: string }
 */
import { Router } from 'express';
import { getSupabase } from '../../config/supabase.js';
import { validateCouponCode, applyCoupon } from '../../domain/couponService.js';

const router = Router();

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

export default router;
