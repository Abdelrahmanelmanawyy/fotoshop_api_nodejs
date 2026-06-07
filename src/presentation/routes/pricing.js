/**
 * GET /pricing/config
 *
 * Public (no auth) — returns the current price table so the Flutter app can
 * display live amounts without shipping a new build when prices change.
 *
 * The Flutter app falls back to its hardcoded constants when this call fails,
 * so offline / unreachable server scenarios are handled gracefully.
 */
import { Router } from 'express';
import { getSupabase } from '../../config/supabase.js';
import { loadPricing, MAX_PHOTOS_PER_ORDER } from '../../domain/printPricingService.js';

const router = Router();

router.get('/config', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const pricing = await loadPricing(supabase);
    res.json({ ...pricing, max_photos_per_order: MAX_PHOTOS_PER_ORDER });
  } catch (err) {
    console.error('[pricing] config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
