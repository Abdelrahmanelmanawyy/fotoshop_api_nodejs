-- 2026-10-20 — Free prints decided by the server (security.md gap G1, G5).
--
-- Before: the app called decrement_freeprint (returns void — succeeds even with 0 free prints left), then
-- inserted print_jobs itself; one free print covered a whole multi-photo bundle. 100% coupons were counted
-- after the jobs existed, without a max_uses check.
--
-- After: the backend (POST /print/free) validates the request and calls this function, which in ONE
-- transaction consumes the entitlement — one free print per photo, or one coupon use (atomic max_uses /
-- validity check) — and creates the print jobs. Service role only.
--
-- Apply BEFORE deploying the backend that serves /print/free. Old app builds keep working until
-- 2026-10-20_post_release_close_client_print_path.sql is applied.

CREATE OR REPLACE FUNCTION public.create_free_print_jobs(
  p_uid          uuid,
  p_booth_code   text,
  p_paper_finish text,
  p_image_urls   text[],
  p_coupon_id    uuid    DEFAULT NULL,
  p_discount_try numeric DEFAULT 0
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int  := coalesce(array_length(p_image_urls, 1), 0);
  v_base  text := 'free' || replace(gen_random_uuid()::text, '-', '');
  v_ids   text[];
BEGIN
  IF v_count < 1 OR v_count > 10 THEN
    RAISE EXCEPTION 'invalid_photo_count';
  END IF;

  IF p_coupon_id IS NULL THEN
    UPDATE public.users
       SET free_physical_prints = free_physical_prints - v_count
     WHERE id = p_uid AND free_physical_prints >= v_count;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_free_prints';
    END IF;
  ELSE
    UPDATE public.coupons
       SET used_count = used_count + 1
     WHERE id = p_coupon_id
       AND active
       AND (max_uses IS NULL OR used_count < max_uses)
       AND valid_from <= now()
       AND (valid_until IS NULL OR valid_until >= now());
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon_unavailable';
    END IF;

    -- Analytics row (replaces /coupon/redeem-free): a zero-price print with the discount recorded.
    INSERT INTO public.payment_transactions
      (id, uid, type, status, amount_try, discount_try, coupon_id, booth_code, image_url, image_urls, copies, paper_finish)
    VALUES
      (v_base, p_uid, 'print', 'free', 0, p_discount_try, p_coupon_id, p_booth_code,
       p_image_urls[1], to_jsonb(p_image_urls), v_count, p_paper_finish);
  END IF;

  INSERT INTO public.print_jobs (id, booth_code, status, image_url, original_image_url, user_id, copies, paper_finish, is_paid_by_money)
  SELECT v_base || '_' || (i - 1), p_booth_code, 'pending', p_image_urls[i], p_image_urls[i], p_uid, 1, p_paper_finish, false
    FROM generate_subscripts(p_image_urls, 1) AS i;

  SELECT array_agg(v_base || '_' || (i - 1) ORDER BY i) INTO v_ids
    FROM generate_subscripts(p_image_urls, 1) AS i;
  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_free_print_jobs(uuid, text, text, text[], uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_free_print_jobs(uuid, text, text, text[], uuid, numeric) TO service_role;
