-- 2026-10-19 — Lock down the remaining SECURITY DEFINER RPCs.
--
-- 2026-06-28_rls_and_function_lockdown.sql only covered add_wallet_credits,
-- spend_credits and grant_welcome_credits(uuid). The older functions below were
-- still executable by `anon` (via the default PUBLIC grant) and by any signed-in
-- user with an arbitrary p_uid / order id. The Supabase security advisor flagged
-- them (anon_security_definer_function_executable).
--
-- Rules applied:
--   * Backend-only functions  -> service_role only (the Node API uses the service key).
--   * Functions the Flutter app calls directly -> authenticated + service_role, with an
--     ownership check (auth.uid() must equal the uid argument) like spend_credits.
--   * Every function gets a fixed search_path.
-- NOTE: REVOKE ... FROM anon is not enough; EXECUTE is granted to PUBLIC by default,
-- so PUBLIC must be revoked as well.

-- 1. Stale text overload (the 2026-08-02_drop_stale_text_overload migration was never applied live).
DROP FUNCTION IF EXISTS public.grant_welcome_credits(TEXT);

-- 2. Backend-only: service_role only.
ALTER FUNCTION public.increment_coupon_used_count(UUID) SET search_path = '';
ALTER FUNCTION public.spend_credit(UUID, TEXT)          SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.set_order_status(TEXT, TEXT, TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_order_credits(TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_used_count(UUID)    FROM PUBLIC, anon, authenticated;
-- Legacy 1-credit spend: unused by the app and the backend (superseded by spend_credits).
REVOKE EXECUTE ON FUNCTION public.spend_credit(UUID, TEXT)             FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_order_status(TEXT, TEXT, TEXT)    TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_order_credits(TEXT)            TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_coupon_used_count(UUID)     TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credit(UUID, TEXT)              TO service_role;

-- 3. Called by the Flutter app: add an ownership check, fixed search_path, no anon.
CREATE OR REPLACE FUNCTION public.claim_referral(p_invitee_uid UUID, p_code TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_inviter UUID; v_count INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_invitee_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_inviter FROM public.users WHERE referral_code = p_code LIMIT 1;
  IF v_inviter IS NULL OR v_inviter = p_invitee_uid THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_invitee_uid AND invited_by IS NOT NULL) THEN RETURN; END IF;
  UPDATE public.users SET invited_by = v_inviter WHERE id = p_invitee_uid;
  UPDATE public.users SET referral_count = referral_count + 1 WHERE id = v_inviter
  RETURNING referral_count INTO v_count;
  IF v_count % 10 = 0 THEN
    UPDATE public.users SET free_physical_prints = free_physical_prints + 1, referral_count = 0 WHERE id = v_inviter;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_freeprint(p_uid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.users
  SET free_physical_prints = free_physical_prints - 1
  WHERE id = p_uid AND free_physical_prints > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(UUID, TEXT)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrement_freeprint(UUID)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_account()       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_referral(UUID, TEXT)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_freeprint(UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_account()        TO authenticated, service_role;
