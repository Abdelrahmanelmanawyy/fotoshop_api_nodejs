-- Make `print_jobs` live-updatable for the Python desktop printer:
--   1. Add the table to the supabase_realtime publication so INSERT events
--      stream to subscribed clients (each booth's listener subscribes with a
--      `booth_code=eq.<code>` server-side filter so it only receives its own
--      booth's jobs — no need for client-side filtering).
--   2. REPLICA IDENTITY FULL so the `record` payload carries every column on
--      INSERT/UPDATE/DELETE — the listener needs `image_url`, `booth_code`,
--      `copies`, `paper_finish`, `user_id`, `is_paid_by_money` from the
--      record body to construct the PrintJob without an extra SELECT.
--
-- Without this migration the Python listener still works (the 30 s safety-net
-- poll picks jobs up eventually), but realtime is the path that gives instant
-- print after payment.
--
-- Run this once in the Supabase SQL editor. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'print_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs;
  END IF;
END $$;

ALTER TABLE public.print_jobs REPLICA IDENTITY FULL;
