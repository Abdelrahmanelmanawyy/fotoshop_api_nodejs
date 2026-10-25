import { applyCoupon, validateCouponCode } from "./couponService.js";
import { bundlePriceForPhotos, loadPricing } from "./printPricingService.js";

/** Errors raised by create_free_print_jobs, mapped to HTTP status + public code. */
const SQL_ERRORS = {
  no_free_prints: { status: 409, error: "no_free_prints" },
  coupon_unavailable: { status: 409, error: "coupon_unavailable" },
  invalid_photo_count: { status: 400, error: "invalid_photo_count" },
};

/**
 * Queue a print the user does not pay money for — either with free prints (one
 * per photo, earned through referrals) or with a coupon that covers the whole
 * server-side price. The entitlement is consumed and the jobs are created in one
 * SQL transaction (create_free_print_jobs), so a free print can never be spent
 * twice or produce jobs without being spent.
 *
 * @returns {Promise<{ ok: true, jobIds: string[] } | { ok: false, status: number, error: string }>}
 */
export async function createFreePrint(supabase, { uid, boothCode, paperFinish, imageUrls, couponCode }) {
  let couponId = null;
  let discountTry = 0;

  if (couponCode) {
    const result = await validateCouponCode(supabase, couponCode);
    if (result.error) return { ok: false, status: 400, error: result.error };

    const price = bundlePriceForPhotos(imageUrls.length, await loadPricing(supabase));
    const applied = applyCoupon(price, result.coupon);
    if (applied.discountedAmount > 0) {
      return { ok: false, status: 400, error: "coupon_not_full_price" };
    }
    couponId = result.coupon.id;
    discountTry = applied.discountTry;
  }

  const { data, error } = await supabase.rpc("create_free_print_jobs", {
    p_uid: uid,
    p_booth_code: boothCode,
    p_paper_finish: paperFinish,
    p_image_urls: imageUrls,
    p_coupon_id: couponId,
    p_discount_try: discountTry,
  });

  if (error) {
    const known = Object.keys(SQL_ERRORS).find((code) => error.message?.includes(code));
    if (known) return { ok: false, ...SQL_ERRORS[known] };
    throw new Error(`create_free_print_jobs failed: ${error.message}`);
  }
  return { ok: true, jobIds: data ?? [] };
}
