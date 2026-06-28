-- ─────────────────────────────────────────────────────────────────────────────
-- RLS lockdown for wallets / wallet_transactions / orders
-- + lock credit-granting/spending functions to their rightful caller
-- ─────────────────────────────────────────────────────────────────────────────
-- Part of PRODUCTION_READINESS_PLAN.md §3 (database security).
--
-- BEFORE this migration: these tables had NO row-level security, so any holder of
-- the public anon key (shipped inside the app) could read or modify ANY user's
-- wallet and orders, and add_wallet_credits / spend_credits were callable by anon
-- (PUBLIC), letting a tampered client mint or drain credits for any uid.
--
-- AFTER this migration:
--   • A user can read only their own wallet, transactions, and orders.
--   • A user can insert only their own orders; orders are not client-updatable.
--   • spend_credits can only spend the caller's own wallet (auth.uid() guard).
--   • add_wallet_credits is service_role only (granting credits is server-only).
--   • grant_welcome_credits is idempotent (no duplicate gift on repeat calls).
--
-- The backend uses the service_role key, which BYPASSES RLS — so all server-side
-- processing, refunds, and IAP/Stripe grants continue to work unchanged.
--
-- ⚠️  Apply order matters: policies are created first, then RLS is enabled, so
--     there is never a window where RLS is on without a policy.
-- Run AFTER 2026-06-28_order_refund_and_status.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. POLICIES (created before RLS is enabled) ───────────────────────────────

-- wallets: owner can read; no client writes (mutated only via SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS wallets_select_own ON public.wallets;
CREATE POLICY wallets_select_own ON public.wallets
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- wallet_transactions: owner can read their ledger; no client writes.
DROP POLICY IF EXISTS wallet_tx_select_own ON public.wallet_transactions;
CREATE POLICY wallet_tx_select_own ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (wallet_id = auth.uid());

-- orders: owner can read their orders and insert their own.
-- No UPDATE/DELETE policy => clients cannot mutate orders (status, photos,
-- credits_spent are written only by the backend via service_role).
DROP POLICY IF EXISTS orders_select_own ON public.orders;
CREATE POLICY orders_select_own ON public.orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS orders_insert_own ON public.orders;
CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── 2. ENABLE RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.wallets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders               ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: also force RLS for table owners other than superuser.
-- (service_role still bypasses via BYPASSRLS, which is what we want.)
ALTER TABLE public.wallets              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders               FORCE ROW LEVEL SECURITY;

-- ── 3. LOCK DOWN add_wallet_credits → service_role only ───────────────────────
-- Granting credits must only ever happen server-side after a verified
-- IAP/Stripe receipt. Default PUBLIC execute is revoked too (the real fix).
REVOKE EXECUTE ON FUNCTION public.add_wallet_credits(UUID, INT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_wallet_credits(UUID, INT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_wallet_credits(UUID, INT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.add_wallet_credits(UUID, INT, TEXT, TEXT, TEXT) TO service_role;
-- NOTE: this disables the client-side test path IapService._grantCreditsForTesting
-- (kSkipPaymentForTesting), which must stay false in production anyway.

-- ── 4. HARDEN spend_credits (both overloads): own wallet only, no anon ─────────

-- 4a. Legacy 3-arg overload — re-defined with an auth.uid() ownership guard.
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid    UUID,
  p_amount INT,
  p_title  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A logged-in caller may only spend their OWN wallet. service_role (auth.uid()
  -- NULL) may target any uid for server-side flows.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  UPDATE public.wallets
    SET credits = credits - p_amount, updated_at = NOW()
    WHERE id = p_uid AND credits >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (p_uid, 'spend', p_title, -p_amount);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT) TO authenticated, service_role;

-- 4b. New idempotent 4-arg overload — add the same ownership guard.
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid             UUID,
  p_amount          INT,
  p_title           TEXT,
  p_idempotency_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT credits INTO v_balance FROM public.wallets WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key AND type = 'spend'
  ) THEN
    RETURN;  -- already charged for this order id
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  UPDATE public.wallets
    SET credits = credits - p_amount, updated_at = NOW()
    WHERE id = p_uid;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta, idempotency_key)
    VALUES (p_uid, 'spend', p_title, -p_amount, p_idempotency_key);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT, TEXT) TO authenticated, service_role;

-- ── 5. Make grant_welcome_credits idempotent + drop anon ──────────────────────
-- Old version logged a +20 'gift' transaction on EVERY call (even when the wallet
-- already existed), polluting the ledger. Now the gift row is only inserted when
-- the wallet is newly created.
CREATE OR REPLACE FUNCTION public.grant_welcome_credits(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.wallets(id, credits)
  VALUES (p_uid, 20)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;  -- 1 = inserted (new), 0 = already existed

  IF v_rows > 0 THEN
    INSERT INTO public.wallet_transactions(wallet_id, type, title, subtitle, delta)
    VALUES (p_uid, 'gift', 'Welcome Gift', '20 free credits to get you started', 20);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.grant_welcome_credits(UUID) TO authenticated, service_role;
