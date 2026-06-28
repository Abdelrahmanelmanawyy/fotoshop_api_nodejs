-- ─────────────────────────────────────────────────────────────────────────────
-- Order status tracking + idempotent credit spend + idempotent refund
-- ─────────────────────────────────────────────────────────────────────────────
-- Part of PRODUCTION_READINESS_PLAN.md §1 (credit integrity, refund & fallback).
--
-- Adds:
--   • orders lifecycle columns (status / credits_spent / refunded_at / attempts /
--     last_error) so the backend can mark terminal failures and refund exactly once.
--   • an idempotency_key on wallet_transactions so a retried spend never double-charges.
--   • spend_credits(uuid,int,text,text) — idempotent overload keyed by the order id.
--   • refund_order_credits(text) — refunds a failed order's credits exactly once.
--
-- Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE).
-- Run in the Supabase SQL editor (or migration tooling) AFTER existing migrations.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Order lifecycle columns ──────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed|refunded
  ADD COLUMN IF NOT EXISTS credits_spent integer,        -- credits charged for this order (authoritative refund amount)
  ADD COLUMN IF NOT EXISTS refunded_at   timestamptz,    -- set once when refunded (idempotency guard)
  ADD COLUMN IF NOT EXISTS attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error    text,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

-- Sweeper / reconciliation query index (orders stuck in pending/processing).
CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON public.orders (status, created_at);

-- 2. Idempotency key on wallet_transactions ───────────────────────────────────
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Only spend rows carry a key (the order id). Partial unique index => a second
-- spend for the same order can never insert, so a retry cannot double-charge.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_spend_idem_idx
  ON public.wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Idempotent spend (4-arg overload) ────────────────────────────────────────
-- Distinct from the existing spend_credits(uuid,int,text). The wallet row is
-- locked FOR UPDATE so concurrent spends on the same wallet serialize, making the
-- idempotency check race-free.
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid             uuid,
  p_amount          integer,
  p_title           text,
  p_idempotency_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- Serialize spends for this wallet.
  SELECT credits INTO v_balance FROM public.wallets WHERE id = p_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found';
  END IF;

  -- Already charged for this order id? No-op (idempotent retry).
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key AND type = 'spend'
  ) THEN
    RETURN;
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  UPDATE public.wallets
    SET credits = credits - p_amount, updated_at = now()
    WHERE id = p_uid;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta, idempotency_key)
    VALUES (p_uid, 'spend', p_title, -p_amount, p_idempotency_key);
END;
$$;

-- Same grants as the existing spend_credits; anon is tightened in the RLS migration.
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, integer, text, text)
  TO authenticated, service_role;

-- 4. Idempotent refund ────────────────────────────────────────────────────────
-- Refunds the credits recorded on an order exactly once. The order row is locked
-- FOR UPDATE and refunded_at gates re-entry, so retries / duplicate sweeps are safe.
-- service_role ONLY — the backend is the refund authority, never the client.
CREATE OR REPLACE FUNCTION public.refund_order_credits(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid;
  v_amount   integer;
  v_refunded timestamptz;
BEGIN
  SELECT user_id, credits_spent, refunded_at
    INTO v_uid, v_amount, v_refunded
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- Already refunded, or nothing was charged → no-op.
  IF v_refunded IS NOT NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    UPDATE public.orders
      SET status = 'refunded', updated_at = now()
      WHERE id = p_order_id AND refunded_at IS NOT NULL;
    RETURN;
  END IF;

  UPDATE public.wallets
    SET credits = credits + v_amount, updated_at = now()
    WHERE id = v_uid;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (v_uid, 'refund', 'AI order refund • ' || p_order_id, v_amount);

  UPDATE public.orders
    SET status = 'refunded', refunded_at = now(), updated_at = now()
    WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_order_credits(text) TO service_role;

-- 5. Status setter used by the backend (service_role) ──────────────────────────
-- Small helper so the route layer doesn't issue ad-hoc updates everywhere.
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id text,
  p_status   text,
  p_error    text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
    SET status = p_status,
        last_error = COALESCE(p_error, last_error),
        attempts = CASE WHEN p_status = 'processing' THEN attempts + 1 ELSE attempts END,
        updated_at = now()
    WHERE id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_status(text, text, text) TO service_role;
