-- Add per-template credit cost to ai_templates.
-- Run in Supabase SQL editor.

ALTER TABLE public.ai_templates
  ADD COLUMN IF NOT EXISTS credit_cost integer NOT NULL DEFAULT 1;

-- Set initial costs per template
UPDATE public.ai_templates SET credit_cost = 2 WHERE id = 'football_poster';
UPDATE public.ai_templates SET credit_cost = 1 WHERE id = 'cinematic';
UPDATE public.ai_templates SET credit_cost = 1 WHERE id = 'night_cinematic';
UPDATE public.ai_templates SET credit_cost = 1 WHERE id = 'studio_ghibli';
UPDATE public.ai_templates SET credit_cost = 1 WHERE id = 'disney_magic';
