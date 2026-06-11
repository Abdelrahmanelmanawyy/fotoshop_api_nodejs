-- ─────────────────────────────────────────────────────────────────────────────
-- Fotoshop Supabase Schema (reference only — do not run directly)
-- Project: rbhphmaodrxptllxkagf.supabase.co
-- Last updated: 2026-06-11
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.users (
  id uuid NOT NULL,
  referral_code text NOT NULL UNIQUE,
  referral_count integer NOT NULL DEFAULT 0,
  free_physical_prints integer NOT NULL DEFAULT 0,
  invited_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT users_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id)
);

CREATE TABLE public.wallets (
  id uuid NOT NULL,
  credits integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wallets_pkey PRIMARY KEY (id),
  CONSTRAINT wallets_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

CREATE TABLE public.wallet_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  subtitle text,
  delta integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id)
);

CREATE TABLE public.booths (
  id text NOT NULL,
  booth_name text,
  is_online boolean NOT NULL DEFAULT false,
  location text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_login timestamp with time zone,
  password_hash text,
  printer_status text,
  printer_ready boolean DEFAULT false,
  CONSTRAINT booths_pkey PRIMARY KEY (id)
);

CREATE TABLE public.orders (
  id text NOT NULL,
  user_id uuid NOT NULL,
  booth_id text,
  kind text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT orders_booth_id_fkey FOREIGN KEY (booth_id) REFERENCES public.booths(id)
);

CREATE TABLE public.print_jobs (
  id text NOT NULL,
  booth_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  image_url text,
  original_image_url text,
  user_id uuid NOT NULL,
  copies integer NOT NULL DEFAULT 1,
  paper_finish text,
  is_paid_by_money boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  CONSTRAINT print_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT print_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.payment_transactions (
  id text NOT NULL,
  uid uuid NOT NULL,
  type text,
  status text NOT NULL DEFAULT 'wait',
  amount_try numeric,
  booth_code text,
  image_url text,
  image_urls jsonb,
  copies integer,
  paper_finish text,
  coupon_id uuid,
  discount_try numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT payment_transactions_uid_fkey FOREIGN KEY (uid) REFERENCES auth.users(id),
  CONSTRAINT payment_transactions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id)
);

CREATE TABLE public.printer_status (
  booth_id text NOT NULL,
  printer_name text,
  status text,
  status_text text,
  is_ready boolean NOT NULL DEFAULT false,
  last_checked timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT printer_status_pkey PRIMARY KEY (booth_id)
);

CREATE TABLE public.app_pricing (
  key text NOT NULL,
  value_try numeric NOT NULL,
  label text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_pricing_pkey PRIMARY KEY (key)
);

CREATE TABLE public.coupons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type = ANY (ARRAY['percent', 'fixed_try'])),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  valid_from timestamp with time zone NOT NULL DEFAULT now(),
  valid_until timestamp with time zone,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT coupons_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ai_templates (
  id           text NOT NULL,
  title        text NOT NULL,
  subtitle     text,
  seed_prompt  text NOT NULL,
  model        text NOT NULL,
  image_url    text,
  input_label  text,
  categories   text[] NOT NULL DEFAULT '{}',
  popular      boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  credit_cost  integer NOT NULL DEFAULT 1,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_templates_pkey PRIMARY KEY (id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Atomically deduct N credits; raises 'insufficient_credits' if balance too low
-- Added: 2026-06-10
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_uid    UUID,
  p_amount INT,
  p_title  TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  UPDATE public.wallets
    SET credits = credits - p_amount, updated_at = NOW()
    WHERE id = p_uid AND credits >= p_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_credits'; END IF;
  INSERT INTO public.wallet_transactions(wallet_id, type, title, delta)
    VALUES (p_uid, 'spend', p_title, -p_amount);
END; $$;

GRANT EXECUTE ON FUNCTION public.spend_credits(UUID, INT, TEXT)
  TO authenticated, anon, service_role;
