/**
 * Server-authoritative print pricing.
 *
 * Prices are stored in the `app_pricing` Supabase table so the admin dashboard
 * can change them at runtime without redeploying. This module keeps a short-lived
 * in-process cache (TTL_MS) so every checkout request does not hit the database.
 *
 * Fallback values match the original hardcoded constants and are used when the
 * DB is unreachable (e.g. during local dev without network).
 */

const TTL_MS = 5 * 60 * 1000; // 5-minute cache

/** @type {{ data: Record<string,number>, loadedAt: number } | null} */
let _cache = null;

/** Default pricing — kept in sync with Flutter `print_config.dart`. */
const DEFAULTS = Object.freeze({
  single_print: 49.99,
  split_print:  59.99,
  bundle_2:     89.99,
  bundle_3:    119.99,
  extra_photo:  39.99,
});

/** Hard cap on photos per order (not stored in DB — structural limit). */
export const MAX_PHOTOS_PER_ORDER = 10;

/**
 * Load prices from the `app_pricing` table, using a cached copy when fresh.
 * Falls back to DEFAULTS if the query fails.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Record<string,number>>}
 */
export async function loadPricing(supabase) {
  const now = Date.now();
  if (_cache && now - _cache.loadedAt < TTL_MS) {
    return _cache.data;
  }

  try {
    const { data: rows, error } = await supabase
      .from('app_pricing')
      .select('key, value_try');

    if (error) throw error;

    const data = { ...DEFAULTS };
    for (const row of rows ?? []) {
      data[row.key] = parseFloat(row.value_try);
    }

    _cache = { data, loadedAt: now };
    return data;
  } catch (err) {
    console.warn('[pricing] DB load failed, using defaults:', err.message);
    return { ...DEFAULTS };
  }
}

/** Force the next call to loadPricing() to re-fetch from the DB. */
export function invalidatePricingCache() {
  _cache = null;
}

/**
 * Total TRY price for [photoCount] single-sheet photos using the tier table.
 * Falls back to per-photo EXTRA_PHOTO pricing beyond the largest defined tier.
 *
 * @param {number} photoCount
 * @param {Record<string,number>} pricing  — result of loadPricing()
 * @returns {number}
 */
export function bundlePriceForPhotos(photoCount, pricing) {
  if (!Number.isInteger(photoCount) || photoCount <= 0) return 0;
  if (photoCount === 1) return pricing.single_print ?? DEFAULTS.single_print;
  if (photoCount === 2) return pricing.bundle_2 ?? DEFAULTS.bundle_2;
  if (photoCount === 3) return pricing.bundle_3 ?? DEFAULTS.bundle_3;

  // Beyond tier 3: largest tier price + extra_photo * overage
  const largestTierPrice = pricing.bundle_3 ?? DEFAULTS.bundle_3;
  const extraPerPhoto    = pricing.extra_photo ?? DEFAULTS.extra_photo;
  return largestTierPrice + extraPerPhoto * (photoCount - 3);
}

/**
 * Validate and normalize a paper finish string.
 * Accepts display strings like "Glossy Premium" for back-compat.
 *
 * @param {unknown} value
 * @returns {'glossy'|'matte'|null}
 */
export function normalizePaperFinish(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'glossy' || v.startsWith('glossy ')) return 'glossy';
  if (v === 'matte'  || v.startsWith('matte '))  return 'matte';
  return null;
}
