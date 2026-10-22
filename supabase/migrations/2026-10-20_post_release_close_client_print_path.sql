-- 2026-10-20 — APPLY ONLY AFTER the app build that uses POST /print/free is the minimum supported version.
--
-- Closes the last client-side print path (security.md gap G1): the app can no longer queue print jobs
-- or spend free prints itself. Applying this earlier breaks free prints in older app builds.

DROP POLICY IF EXISTS print_jobs_insert_own_free ON public.print_jobs;
REVOKE INSERT ON public.print_jobs FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.decrement_freeprint(uuid) FROM authenticated;
