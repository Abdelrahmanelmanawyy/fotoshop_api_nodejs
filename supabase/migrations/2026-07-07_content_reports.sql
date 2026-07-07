-- ─────────────────────────────────────────────────────────────────────────────
-- Content reports — store-compliance requirement for AI-generated images
-- ─────────────────────────────────────────────────────────────────────────────
-- Apple Guideline 1.2 / Google Play AI-generated-content policy require an
-- in-app way for users to report objectionable generated content. The app
-- inserts a row here; review happens in the Supabase dashboard (or any admin
-- tool using the service_role key). Reports must be triaged within 24h to
-- meet Apple's expectation for objectionable-content handling.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.content_reports (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id   text,                          -- orders.id ('ORD_...'), nullable for future surfaces
  photo_id   text,                          -- photo inside the order ('PH_1')
  image_url  text,                          -- direct URL of the reported image
  reason     text NOT NULL,                 -- inappropriate|sexual|violent|copyright|other
  details    text,                          -- optional free text from the user
  status     text NOT NULL DEFAULT 'open',  -- open|reviewed|actioned|dismissed
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Triage queue: newest open reports first.
CREATE INDEX IF NOT EXISTS content_reports_status_created_idx
  ON public.content_reports (status, created_at DESC);

-- RLS: users may file reports about their own account's content and see what
-- they filed. Only the backend/admin (service_role, bypasses RLS) can update
-- status or read the full queue.
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_reports_insert_own ON public.content_reports;
CREATE POLICY content_reports_insert_own ON public.content_reports
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS content_reports_select_own ON public.content_reports;
CREATE POLICY content_reports_select_own ON public.content_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT ON public.content_reports TO authenticated;
