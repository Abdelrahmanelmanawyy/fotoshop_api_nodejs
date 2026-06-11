-- Seed initial app_pricing rows.
-- Run once in the Supabase SQL editor.
-- All existing rows are left untouched (ON CONFLICT DO NOTHING).

INSERT INTO public.app_pricing (key, value_try, label) VALUES
  -- ── Print prices (Turkish Lira) ──────────────────────────────────────────
  ('single_print',  49.99, '1 Photo'),
  ('split_print',   59.99, '1 Split Photo'),
  ('bundle_2',      89.99, '2 Photos Bundle'),
  ('bundle_3',     119.99, '3 Photos Bundle'),
  ('extra_photo',   39.99, 'Extra Photo (beyond 3)'),

  -- ── AI photo credit costs (stored as whole numbers) ───────────────────────
  ('ai_photo_credits',          1,  'AI Photo — credits per generation'),

  -- ── Biometric photo credit costs ─────────────────────────────────────────
  ('biometric_standard_credits', 15, 'Biometric Standard Pack — credit cost'),
  ('biometric_hybrid_credits',   25, 'Biometric Hybrid Pack — credit cost'),
  ('biometric_combo_credits',    30, 'Biometric Combo Pack — credit cost')

ON CONFLICT (key) DO NOTHING;
