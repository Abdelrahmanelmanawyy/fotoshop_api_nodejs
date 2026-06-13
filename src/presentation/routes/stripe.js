import { Router } from 'express';
import { getSupabase } from '../../config/supabase.js';
import { createCheckoutSession, handleWebhookEvent } from '../../domain/stripeService.js';

const router = Router();

router.use((req, res, next) => {
  try {
    getSupabase();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Supabase initialization failed', message: err.message });
  }
});

/**
 * POST /stripe/checkout
 * Body: { uid, productId }  (productId: credits_20 | credits_50 | credits_100)
 *
 * Creates a Stripe Checkout Session (price decided server-side) and returns its
 * hosted URL. The web app redirects the browser to this URL. Credits are granted
 * later by the webhook, NOT here.
 */
router.post('/checkout', async (req, res) => {
  try {
    const { uid, productId } = req.body || {};
    if (!uid || !productId) {
      return res.status(400).json({ error: 'uid and productId are required' });
    }

    console.log(`[API] POST /stripe/checkout uid=${uid} product=${productId}`);

    const result = await createCheckoutSession({ uid, productId });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ url: result.url, id: result.id });
  } catch (err) {
    console.error('[Stripe] checkout error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * POST /stripe/webhook  (mounted separately in index.js with a RAW body parser)
 *
 * Stripe calls this server-to-server after payment. We verify the signature and,
 * on checkout.session.completed, grant credits exactly once. Must receive the
 * raw request body, so it is NOT registered on this JSON router — see index.js.
 */
export async function stripeWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  try {
    const event = await handleWebhookEvent(req.body, signature);
    console.log(`[Stripe] webhook handled: ${event.type}`);
    res.json({ received: true });
  } catch (err) {
    // Signature failure or processing error -> 400 so Stripe retries.
    console.error('[Stripe] webhook error:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
}

export default router;
