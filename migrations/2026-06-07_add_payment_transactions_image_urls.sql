-- ------------------------------------------------------------------
-- Multi-photo bundles: allow a single payment_transactions row to carry
-- the full list of image URLs in a multi-photo order. On the PayTR
-- callback the route fans out into N print_jobs rows (one per image).
--
-- - `image_url` (existing TEXT) is kept populated with the FIRST URL of
--   the bundle so legacy readers keep working.
-- - `image_urls` (new JSONB) holds the canonical array of all photo URLs
--   in the order (1..MAX_PHOTOS_PER_ORDER).
--
-- Safe to re-run: uses `IF NOT EXISTS`.
-- ------------------------------------------------------------------

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS image_urls JSONB;

COMMENT ON COLUMN public.payment_transactions.image_urls IS
  'Multi-photo bundle: JSON array of image URLs (legacy image_url stays = image_urls[0]).';
