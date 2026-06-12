-- Make `ai_templates` live-updatable from the mobile app:
--   1. SELECT for anon + authenticated is already allowed by the existing
--      `allow_read_ai_templates` policy from 2026-06-11_add_ai_templates.sql,
--      so we don't redefine it here.
--   2. Add the table to the supabase_realtime publication so INSERT/UPDATE/DELETE
--      events stream to subscribed clients.
--   3. REPLICA IDENTITY FULL so DELETE events carry the old row's id (the
--      primary key column) — needed for Realtime postgres_changes to emit a
--      meaningful `old` payload on row deletion (otherwise the Flutter app
--      can't tell which template just got removed).
--
-- Run this once in the Supabase SQL editor. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_templates;
  END IF;
END $$;

ALTER TABLE public.ai_templates REPLICA IDENTITY FULL;
