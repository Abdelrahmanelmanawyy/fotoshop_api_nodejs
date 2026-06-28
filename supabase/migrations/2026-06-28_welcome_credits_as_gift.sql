-- Record signup welcome credits as gifts (not revenue) and backfill existing rows.

CREATE OR REPLACE FUNCTION public.grant_welcome_credits(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.wallets(id, credits)
  VALUES (p_uid, 20)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, subtitle, delta)
  VALUES (p_uid, 'gift', 'Welcome Gift', '20 free credits to get you started', 20);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_welcome_credits(UUID)
  TO authenticated, anon, service_role;

-- Legacy welcome rows were stored as topup and inflated purchased/revenue totals.
UPDATE public.wallet_transactions
SET type = 'gift'
WHERE type = 'topup'
  AND lower(trim(title)) = 'welcome gift';
