-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: FORCE ROW LEVEL SECURITY silently blocks SECURITY DEFINER writes
-- ─────────────────────────────────────────────────────────────────────────────
-- Companion to 2026-07-19_fix_welcome_credits_idempotent.sql, which diagnosed
-- and fixed this exact issue for grant_welcome_credits: on this project, the
-- SECURITY DEFINER function owner does not carry BYPASSRLS, so once
-- FORCE ROW LEVEL SECURITY is on (wallets/wallet_transactions/orders, since
-- 2026-06-28_rls_and_function_lockdown.sql), every write these functions make
-- is silently filtered by RLS unless the function explicitly disables RLS
-- checking for its own execution via `SET row_security = off`.
--
-- This applies the identical fix to every other SECURITY DEFINER function that
-- writes to wallets/wallet_transactions/orders: add_wallet_credits,
-- spend_credits (both overloads), refund_order_credits, set_order_status.
-- No logic changes — each function's ownership/idempotency guards (auth.uid()
-- checks, idempotency keys, FOR UPDATE locks) are unchanged and remain the
-- real security boundary; row_security=off only removes a redundant internal
-- layer for functions whose entire purpose is to be the sole authorized
-- writer of these tables.
--
-- Run in the Supabase SQL editor after the 2026-07-19 migration.
-- Safe to run more than once (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. add_wallet_credits — also adds SET search_path (was missing).
CREATE OR REPLACE FUNCTION public.add_wallet_credits(
  p_uid      UUID,
  p_delta    INT,
  p_title    TEXT,
  p_subtitle TEXT DEFAULT NULL,
  p_type     TEXT DEFAULT 'purchase'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

-- 2. spend_credits (3-arg legacy overload)
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid    UUID,
  p_amount INT,
  p_title  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
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

-- 3. spend_credits (4-arg idempotent overload)
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid             UUID,
  p_amount          INT,
  p_title           TEXT,
  p_idempotency_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

-- 4. refund_order_credits
CREATE OR REPLACE FUNCTION public.refund_order_credits(p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

  IF v_refunded IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(-delta), 0)
    INTO v_spent
    FROM public.wallet_transactions
    WHERE idempotency_key = p_order_id AND type = 'spend';

  IF v_spent <= 0 THEN
    UPDATE public.orders
      SET status = 'refunded', refunded_at = now(), updated_at = now()
      WHERE id = p_order_id;
    RETURN;
  END IF;

  UPDATE public.wallets
    SET credits = credits + v_spent, updated_at = now()
    WHERE id = v_uid;

  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (v_uid, 'refund', 'AI order refund • ' || p_order_id, v_spent);

  UPDATE public.orders
    SET status = 'refunded', refunded_at = now(), updated_at = now()
    WHERE id = p_order_id;
END;
$$;

-- 5. set_order_status
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id text,
  p_status   text,
  p_error    text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  UPDATE public.orders
    SET status = p_status,
        last_error = COALESCE(p_error, last_error),
        attempts = CASE WHEN p_status = 'processing' THEN attempts + 1 ELSE attempts END,
        updated_at = now()
    WHERE id = p_order_id;
$$;

-- Grants are unchanged by this migration (already correct from prior
-- migrations) — CREATE OR REPLACE preserves existing GRANTs automatically.
