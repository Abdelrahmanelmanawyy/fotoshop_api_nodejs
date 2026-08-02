-- Fix welcome credits under FORCE ROW LEVEL SECURITY.
--
-- wallets / wallet_transactions have FORCE RLS with SELECT-only policies.
-- SECURITY DEFINER alone is not enough when the function owner does not have
-- BYPASSRLS — INSERT/UPDATE then silently affects 0 rows or errors.
--
-- Also: grant once by Welcome Gift transaction (not by "wallet insert succeeded").

CREATE OR REPLACE FUNCTION public.grant_welcome_credits(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.wallets(id, credits)
  VALUES (p_uid, 0)
  ON CONFLICT (id) DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM public.wallet_transactions
    WHERE wallet_id = p_uid
      AND type = 'gift'
      AND lower(trim(title)) = 'welcome gift'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.wallets
  SET credits = credits + 20,
      updated_at = NOW()
  WHERE id = p_uid;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, subtitle, delta)
  VALUES (p_uid, 'gift', 'Welcome Gift', '20 free credits to get you started', 20);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) TO authenticated, service_role;

-- public.users must be writable by the signed-in user for OAuth profile bootstrap.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS users_insert_own ON public.users;
CREATE POLICY users_insert_own ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
