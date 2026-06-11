-- Separate "purchased" (real money) credits from "gifted" (free) credits.
-- Run in Supabase SQL editor.
--
-- Convention going forward:
--   type = 'purchase'  → real money (in-app purchase)
--   type = 'gift'      → free credits granted by admin / promo
--   type = 'spend'     → deduction
--   type = 'topup'     → LEGACY (pre-split). Treated as purchased in reports.
--
-- add_wallet_credits gains an optional p_type (default 'purchase', since its
-- primary caller is the IAP flow). The 4-arg signature is dropped and replaced
-- by a version with defaults so existing 4-arg calls still work.

DROP FUNCTION IF EXISTS public.add_wallet_credits(UUID, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.add_wallet_credits(
  p_uid      UUID,
  p_delta    INT,
  p_title    TEXT,
  p_subtitle TEXT DEFAULT NULL,
  p_type     TEXT DEFAULT 'purchase'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  INSERT INTO public.wallets(id, credits) VALUES (p_uid, p_delta)
  ON CONFLICT (id) DO UPDATE
    SET credits = wallets.credits + p_delta, updated_at = NOW();

  INSERT INTO public.wallet_transactions(wallet_id, type, title, subtitle, delta)
  VALUES (p_uid, p_type, p_title, p_subtitle, p_delta);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_wallet_credits(UUID, INT, TEXT, TEXT, TEXT)
  TO authenticated, anon, service_role;
