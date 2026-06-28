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
-- Refunds the credits ACTUALLY spent on an order, exactly once. The order row is
-- locked FOR UPDATE and refunded_at gates re-entry, so retries / duplicate sweeps
-- are safe. service_role ONLY — the backend is the refund authority, never the
-- client.
--
-- SECURITY: the refund amount is derived from the server-recorded spend ledger
-- (the wallet_transactions 'spend' row that spend_credits wrote, keyed by the
-- order id), NOT from orders.credits_spent — because a client can write any value
-- into credits_spent when it inserts its own order (RLS only checks user_id).
-- Trusting that column would let a tampered client mint credits by inserting a
-- huge credits_spent and forcing a failure. The ledger is the source of truth.
CREATE OR REPLACE FUNCTION public.refund_order_credits(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid;
  v_refunded timestamptz;
  v_spent    integer;
BEGIN
  SELECT user_id, refunded_at
    INTO v_uid, v_refunded
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- Already refunded → no-op (idempotent).
  IF v_refunded IS NOT NULL THEN
    RETURN;
  END IF;

  -- Authoritative amount = what spend_credits actually deducted for this order
  -- (idempotency_key = order id, set by the 4-arg overload). Never trust the
  -- client-written orders.credits_spent.
  SELECT COALESCE(SUM(-delta), 0)
    INTO v_spent
    FROM public.wallet_transactions
    WHERE idempotency_key = p_order_id AND type = 'spend';

  IF v_spent <= 0 THEN
    -- Nothing verifiably spent (e.g. legacy/biometric order without a keyed
    -- spend) → just mark refunded, don't credit anything.
    UPDATE public.orders
      SET status = 'refunded', refunded_at = now(), updated_at = now()
      WHERE id = p_order_id;
    RETURN;
  END IF;

  UPDATE public.wallets
    SET credits = credits + v_spent, updated_at = now()
    WHERE id = v_uid;

  -- Refund rows leave idempotency_key NULL (the unique index is global); refund
  -- idempotency is guaranteed by the FOR UPDATE lock + refunded_at above.
  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (v_uid, 'refund', 'AI order refund • ' || p_order_id, v_spent);

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
