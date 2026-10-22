-- 2026-10-19 — Close direct-write holes left by the original broad RLS policies.
--
-- 2026-06-28_rls_and_function_lockdown.sql ADDED narrow policies (wallets_select_own, orders_insert_own, ...)
-- but never DROPPED the original catch-all ones (wallets_own, wallet_tx_own, orders_own, print_jobs_own, ...).
-- Permissive policies are OR'ed, and `authenticated` holds table-level INSERT/UPDATE/DELETE on every table,
-- so live today a signed-in user can, with the public anon key + their own JWT:
--   * UPDATE wallets SET credits = <anything> on their own wallet;
--   * INSERT a fake 'spend' wallet_transaction keyed to an order, which refund_order_credits then pays out;
--   * UPDATE their order (reset refunded_at/status) to be refunded or re-processed again;
--   * INSERT print_jobs flagged is_paid_by_money = true;
--   * UPDATE users.free_physical_prints / referral_count / invited_by;
--   * read every user's profile row (users_select).
--
-- Rule after this migration: clients READ their own rows; they may only INSERT the rows the app creates
-- (users profile, orders, free print_jobs), with constrained values. Every balance/status change goes through
-- SECURITY DEFINER RPCs or the backend's service-role key (which bypasses RLS and is unaffected).

-- ── wallets / wallet_transactions: read-only for clients ─────────────────────────────────────────────
DROP POLICY IF EXISTS wallets_own   ON public.wallets;
DROP POLICY IF EXISTS wallet_tx_own ON public.wallet_transactions;
REVOKE INSERT, UPDATE, DELETE ON public.wallets, public.wallet_transactions FROM anon, authenticated;

-- ── orders: insert own new order, read own; no client updates/deletes ───────────────────────────────
DROP POLICY IF EXISTS orders_own        ON public.orders;
DROP POLICY IF EXISTS orders_insert_own ON public.orders;
CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND refunded_at IS NULL AND COALESCE(attempts, 0) = 0);
REVOKE UPDATE, DELETE ON public.orders FROM anon, authenticated;

-- ── print_jobs: read own; clients may only queue FREE pending jobs (paid jobs come from the PayTR callback) ─
DROP POLICY IF EXISTS print_jobs_own ON public.print_jobs;
DROP POLICY IF EXISTS print_jobs_select_own ON public.print_jobs;
DROP POLICY IF EXISTS print_jobs_insert_own_free ON public.print_jobs;
CREATE POLICY print_jobs_select_own ON public.print_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY print_jobs_insert_own_free ON public.print_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND is_paid_by_money = false);
REVOKE UPDATE, DELETE ON public.print_jobs FROM anon, authenticated;

-- ── payment_transactions: written only by the backend ──────────────────────────────────────────────
DROP POLICY IF EXISTS payment_tx_insert ON public.payment_transactions;
REVOKE INSERT, UPDATE, DELETE ON public.payment_transactions FROM anon, authenticated;

-- ── users: own row only; counters are server-owned ─────────────────────────────────────────────────
DROP POLICY IF EXISTS users_select ON public.users;   -- let every signed-in user read every profile
DROP POLICY IF EXISTS users_insert ON public.users;   -- duplicate of users_insert_own (role public)
REVOKE DELETE ON public.users FROM anon, authenticated;

-- The app upserts its own profile row on sign-up (id, referral_code, zeros). Keep that working, but make
-- the reward counters immutable for client roles. SECURITY DEFINER RPCs (claim_referral,
-- decrement_freeprint) run as the owner, so current_user is not a client role and they pass through.
CREATE OR REPLACE FUNCTION public.users_protect_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.referral_count       := 0;
      NEW.free_physical_prints := 0;
      NEW.invited_by           := NULL;
    ELSE
      NEW.referral_count       := OLD.referral_count;
      NEW.free_physical_prints := OLD.free_physical_prints;
      NEW.invited_by           := OLD.invited_by;
      NEW.referral_code        := COALESCE(OLD.referral_code, NEW.referral_code);
      NEW.created_at           := OLD.created_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_server_fields ON public.users;
CREATE TRIGGER users_protect_server_fields
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_protect_server_fields();

-- ── config tables: RLS already blocks client writes; remove the table grants too (defence in depth) ─
REVOKE INSERT, UPDATE, DELETE
  ON public.ai_templates, public.app_pricing, public.coupons, public.booths, public.printer_status
  FROM anon, authenticated;

-- KNOWN GAP (needs an app release, not SQL): free prints are still decided by the client
-- (print_jobs_insert_own_free). Move free/coupon prints behind a backend endpoint that checks entitlement,
-- then drop print_jobs_insert_own_free. booths.password_hash is readable by signed-in users via
-- `select()`/realtime — move it to a service-only table.
