-- AI Templates table — managed from the admin dashboard.
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.ai_templates (
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
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_templates_pkey PRIMARY KEY (id)
);

-- RLS: admin panel uses service role key so no RLS needed for writes.
-- Flutter reads with anon key, so allow SELECT for authenticated/anon.
ALTER TABLE public.ai_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_read_ai_templates"
  ON public.ai_templates FOR SELECT
  USING (true);

-- Seed from the existing hardcoded templates in ai_screen.dart
INSERT INTO public.ai_templates
  (id, title, subtitle, seed_prompt, model, image_url, input_label, categories, popular, sort_order)
VALUES
  (
    'football_poster',
    'Football Poster',
    'Sports Style',
    '{input} themed poster, keep my face exactly as it is, place it on a football player body wearing the team kit, realistic, dramatic stadium lighting, HD',
    'gptImageReplicate',
    'https://images.unsplash.com/photo-1551958219-acbc4d7c5b66?w=400',
    'Which team?',
    ARRAY['sports'],
    true,
    1
  ),
  (
    'cinematic',
    'Cinematic',
    'Film Style',
    'cinematic, dramatic lighting, shallow depth of field, film color grading, ultra realistic, 4K',
    'nanoBanana',
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400',
    NULL,
    ARRAY['cinematic'],
    true,
    2
  ),
  (
    'night_cinematic',
    'Night Cinematic',
    'Dark Film Style',
    'night cinematic style, neon and warm lighting mix, subtle motion blur, dramatic shadows, film color grading',
    'nanoBanana',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400',
    NULL,
    ARRAY['cinematic'],
    false,
    3
  ),
  (
    'studio_ghibli',
    'Studio Ghibli',
    'Anime Style',
    'ghibli style',
    'nanoBanana',
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400',
    NULL,
    ARRAY['artistic'],
    true,
    4
  ),
  (
    'disney_magic',
    'Disney Magic',
    'Animation Style',
    'MAKE DISNEY STYLE',
    'nanoBanana',
    'https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?w=400',
    NULL,
    ARRAY['artistic'],
    true,
    5
  )
ON CONFLICT (id) DO NOTHING;
