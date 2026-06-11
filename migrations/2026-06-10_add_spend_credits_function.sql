-- ─────────────────────────────────────────────────────────────────────────────
-- spend_credits: atomically deduct N credits from a wallet.
-- ─────────────────────────────────────────────────────────────────────────────
-- Deducts p_amount credits only if the balance covers it; otherwise raises
-- 'insufficient_credits' (the app catches this and tells the user to top up).
-- Logs a single 'spend' row in wallet_transactions.
--
-- Used by:
--   • AI photo generation        → p_amount = 1
--   • Biometric photo processing → p_amount = pack credits (15 / 25 / 30)
--
-- Generalizes the older single-credit spend_credit(p_uid, p_title) helper.
-- Run once in the Supabase SQL editor (or via your migration tooling).

CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid    UUID,
  p_amount INT,
  p_title  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  UPDATE public.wallets
    SET credits = credits - p_amount,
        updated_at = NOW()
    WHERE id = p_uid AND credits >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (p_uid, 'spend', p_title, -p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT)
  TO authenticated, anon, service_role;
