/**
 * Coupon validation + application logic.
 *
 * Used by both the pre-checkout /coupon/validate preview endpoint and the
 * authoritative /paytr/token endpoint that actually charges the customer.
 */

/**
 * Fetch and validate a coupon code.
 * Returns the coupon row if valid, or a string describing why it is invalid.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} rawCode
 * @returns {Promise<{ coupon: Record<string,any> } | { error: string }>}
 */
export async function validateCouponCode(supabase, rawCode) {
  if (!rawCode || typeof rawCode !== 'string') {
    return { error: 'Coupon code is required' };
  }

  const code = rawCode.trim().toUpperCase();

  const { data: coupon, error: dbErr } = await supabase
    .from('coupons')
    .select('*')
    .ilike('code', code)   // case-insensitive match
    .eq('active', true)
    .maybeSingle();

  if (dbErr) {
    console.error('[coupon] DB error:', dbErr.message);
    return { error: 'Could not validate coupon. Please try again.' };
  }

  if (!coupon) {
    return { error: 'Coupon code not found or inactive.' };
  }

  // Check usage cap
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return { error: 'This coupon has reached its maximum number of uses.' };
  }

  // Check date window
  const now = new Date();
  if (coupon.valid_from && new Date(coupon.valid_from) > now) {
    return { error: 'This coupon is not yet valid.' };
  }
  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return { error: 'This coupon has expired.' };
  }

  return { coupon };
}

/**
 * Compute the discounted price. Pure function — does NOT touch the database.
 *
 * @param {number} originalTry
 * @param {{ discount_type: string, discount_value: number }} coupon
 * @returns {{ discountedAmount: number, discountTry: number, discountLabel: string }}
 */
export function applyCoupon(originalTry, coupon) {
  const value = parseFloat(coupon.discount_value);
  let discountTry;

  if (coupon.discount_type === 'percent') {
    discountTry = parseFloat(((originalTry * value) / 100).toFixed(2));
  } else {
    // fixed_try
    discountTry = Math.min(value, originalTry);
  }

  const discountedAmount = parseFloat((originalTry - discountTry).toFixed(2));
  const discountLabel =
    coupon.discount_type === 'percent'
      ? `${value}% off`
      : `₺${discountTry.toFixed(2)} off`;

  return { discountedAmount, discountTry, discountLabel };
}

/**
 * Atomically increment the coupon's used_count.
 * Called once the PayTR token is successfully created (not on /coupon/validate).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} couponId
 */
export async function incrementCouponUsage(supabase, couponId) {
  const { error } = await supabase.rpc('increment_coupon_used_count', {
    p_coupon_id: couponId,
  });
  if (error) {
    // Non-fatal — log and continue. The payment already created.
    console.error('[coupon] increment_coupon_used_count RPC failed:', error.message);
  }
}
