-- Make `app_pricing` live-updatable from the mobile app:
--   1. Allow anon + authenticated to SELECT (pricing is public info anyway — the
--      same values are already served via the public GET /pricing/config endpoint).
--   2. Keep INSERT / UPDATE / DELETE service-role-only (only the admin api-server
--      and the main backend should write).
--   3. Add the table to the supabase_realtime publication so the Flutter app can
--      subscribe via `client.from('app_pricing').stream(...)` and react instantly
--      when the dashboard saves a new price.
--
-- Run this once in the Supabase SQL editor. Idempotent.

-- 1. Drop the old service-role-only policy (was a single ALL policy).
DROP POLICY IF EXISTS "service_role_only" ON public.app_pricing;

-- 2. Public read (anon + authenticated) — pricing is not sensitive.
DROP POLICY IF EXISTS "app_pricing_public_read" ON public.app_pricing;
CREATE POLICY "app_pricing_public_read"
  ON public.app_pricing
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 3. Writes restricted to service_role (admin api-server + main backend).
DROP POLICY IF EXISTS "app_pricing_service_role_write" ON public.app_pricing;
CREATE POLICY "app_pricing_service_role_write"
  ON public.app_pricing
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Add to realtime publication so INSERT/UPDATE/DELETE events stream to clients.
--    Wrapped in DO block because ALTER PUBLICATION fails if the table is already in it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_pricing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_pricing;
  END IF;
END $$;

-- 5. REPLICA IDENTITY FULL so DELETE / UPDATE events carry the old row's primary
--    key (key column) — required for Supabase Realtime postgres_changes to emit
--    a meaningful payload on row deletion.
ALTER TABLE public.app_pricing REPLICA IDENTITY FULL;
