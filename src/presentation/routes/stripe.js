import { Router } from 'express';
import { createCheckoutSession, handleWebhookEvent } from '../../domain/stripeService.js';
import { authenticate, resolveUserId } from '../middleware/auth.js';
import { generalRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * POST /stripe/checkout
 * Body: { productId, uid? }  (productId: credits_20 | credits_50 | credits_100)
 *
 * Creates a Stripe Checkout Session (price decided server-side) and returns its
 * hosted URL. The web app redirects the browser to this URL. Credits are granted
 * later by the webhook, NOT here.
 */
router.post('/checkout', authenticate, generalRateLimiter, async (req, res) => {
  try {
    const { productId } = req.body || {};
    const who = resolveUserId(req, req.body?.uid);
    if (!who.ok) return res.status(who.status).json({ error: who.error });
    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    console.log(`[API] POST /stripe/checkout uid=${who.uid} product=${productId}`);

    const result = await createCheckoutSession({ uid: who.uid, productId });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ url: result.url, id: result.id });
  } catch (err) {
    console.error('[Stripe] checkout error:', err);
    res.status(500).json({ error: 'checkout_failed' });
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
    res.status(400).json({ error: 'webhook_rejected' });
  }
}

export default router;
