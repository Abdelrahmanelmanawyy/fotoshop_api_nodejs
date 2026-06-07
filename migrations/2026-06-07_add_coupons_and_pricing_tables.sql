-- ─────────────────────────────────────────────────────────────────────────────
-- Dynamic pricing + coupon system
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. app_pricing: one row per price key, editable from the admin dashboard.
--    The Node API reads this table (with a short TTL cache) instead of using
--    hardcoded constants so prices can be changed without redeploying the app.
CREATE TABLE IF NOT EXISTS public.app_pricing (
  key        TEXT PRIMARY KEY,
  value_try  NUMERIC(10,2) NOT NULL,
  label      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_pricing IS
  'Admin-editable price table. Each row is a named price key used by the Node API.';

-- Seed with current hardcoded values — INSERT … ON CONFLICT DO NOTHING so
-- re-running the migration is safe.
INSERT INTO public.app_pricing (key, value_try, label) VALUES
  ('single_print',  49.99, 'Single biometric / quick print (per sheet)'),
  ('split_print',   59.99, 'Split sheet — 2 photos on one 4×6 paper'),
  ('bundle_2',      89.99, 'Quick Print bundle — 2 distinct photos'),
  ('bundle_3',     119.99, 'Quick Print bundle — 3 distinct photos'),
  ('extra_photo',   39.99, 'Extra photo beyond the largest bundle tier')
ON CONFLICT (key) DO NOTHING;

-- 2. coupons: admin-managed discount codes.
CREATE TABLE IF NOT EXISTS public.coupons (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT        NOT NULL,
  discount_type  TEXT        NOT NULL CHECK (discount_type IN ('percent', 'fixed_try')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_uses       INTEGER,            -- NULL = unlimited
  used_count     INTEGER     NOT NULL DEFAULT 0,
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until    TIMESTAMPTZ,        -- NULL = no expiry
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Codes are stored and looked up in upper-case so 'summer20' = 'SUMMER20'.
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_idx
  ON public.coupons (upper(code));

COMMENT ON TABLE public.coupons IS
  'Discount codes redeemable at print checkout. Validated server-side in /paytr/token.';

-- 3. payment_transactions: add coupon tracking columns.
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS coupon_id    UUID REFERENCES public.coupons(id),
  ADD COLUMN IF NOT EXISTS discount_try NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payment_transactions.coupon_id IS
  'Coupon applied at checkout, if any.';
COMMENT ON COLUMN public.payment_transactions.discount_try IS
  'TRY amount discounted by the coupon (0 when none).';

-- 4. Atomic increment helper (avoids read-modify-write races on high traffic).
CREATE OR REPLACE FUNCTION public.increment_coupon_used_count(p_coupon_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.coupons
  SET used_count = used_count + 1
  WHERE id = p_coupon_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_coupon_used_count(uuid) TO service_role;

-- 5. RLS — app_pricing is admin-only (service role reads/writes it; anon cannot)
ALTER TABLE public.app_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.app_pricing
  USING (false)        -- deny all by default; service role bypasses RLS
  WITH CHECK (false);

-- coupons: same — only service role (Node API + admin) touches this table
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.coupons
  USING (false)
  WITH CHECK (false);
