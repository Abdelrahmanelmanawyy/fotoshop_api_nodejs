-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: PGRST203 "Multiple Choices" on grant_welcome_credits
-- ─────────────────────────────────────────────────────────────────────────────
-- A stale grant_welcome_credits(p_uid TEXT) overload exists alongside the
-- current grant_welcome_credits(p_uid UUID) (every migration in this repo has
-- always used UUID — CREATE OR REPLACE only replaces a function with the exact
-- same parameter TYPES, so the old text overload was never touched/dropped by
-- any later migration and has been silently sitting there).
--
-- With both overloads present, PostgREST cannot decide which one the client
-- meant when calling rpc('grant_welcome_credits', {p_uid: ...}) and fails
-- every single call with PGRST203 "Could not choose the best candidate
-- function" — meaning welcome credits have never actually been granted via
-- the app, regardless of any RLS fix.
--
-- This drops ONLY the stale text overload. The uuid overload (already fixed
-- for FORCE RLS + idempotency in 2026-07-19/2026-08-02) is untouched.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.grant_welcome_credits(TEXT);
