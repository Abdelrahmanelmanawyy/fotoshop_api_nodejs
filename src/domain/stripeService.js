import Stripe from 'stripe';
import { getSupabase } from '../config/supabase.js';

/**
 * Stripe Checkout for WEB credit purchases (photoshopapp.com).
 *
 * This is the web counterpart of `iapService.js`: the mobile app keeps using
 * Google Play / Apple IAP via `/iap/verify`, while the browser version pays
 * with Stripe and lands here. Both end up calling the SAME Supabase RPC
 * `add_wallet_credits`, so credits land in the same wallet regardless of how
 * they were bought.
 *
 * Credit packs and their prices. Amount is in the smallest currency unit
 * (e.g. kuruş for TRY: 4900 = ₺49.00). Override per-pack and the currency via
 * env so prices can be tuned without a redeploy. Keep `credits` in sync with
 * Flutter's lib/core/constants/payment_config.dart -> kProductCredits and with
 * iapService.js -> PRODUCT_CREDITS.
 */
const PRODUCTS = {
  credits_20: { credits: 20, amount: Number(process.env.STRIPE_PRICE_CREDITS_20 ?? 4900) },
  credits_50: { credits: 50, amount: Number(process.env.STRIPE_PRICE_CREDITS_50 ?? 9900) },
  credits_100: { credits: 100, amount: Number(process.env.STRIPE_PRICE_CREDITS_100 ?? 14900) },
};

const CURRENCY = process.env.STRIPE_CURRENCY ?? 'try';

let _stripe = null;
function stripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/**
 * Create a Stripe Checkout Session for a credit pack. The price is decided
 * SERVER-SIDE from PRODUCTS (the client only sends a productId), so the browser
 * can never set its own price. uid + productId + credits are stored in the
 * session metadata and read back in the webhook to grant credits.
 *
 * Returns { ok: true, url, id } or { ok: false, status, error }.
 */
export async function createCheckoutSession({ uid, productId }) {
  const product = PRODUCTS[productId];
  if (!product) {
    return { ok: false, status: 400, error: 'unknown_product' };
  }

  const successUrl =
    process.env.STRIPE_SUCCESS_URL ?? 'https://photoshopapp.com/#/wallet?purchase=success';
  const cancelUrl =
    process.env.STRIPE_CANCEL_URL ?? 'https://photoshopapp.com/#/wallet?purchase=cancel';

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: product.amount,
          product_data: { name: `${product.credits} Kredi` },
        },
      },
    ],
    metadata: { uid, productId, credits: String(product.credits) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { ok: true, url: session.url, id: session.id };
}

/**
 * Verify + parse an incoming webhook payload. Pass the RAW request body
 * (Buffer/string, NOT JSON-parsed) and the `stripe-signature` header.
 * When STRIPE_WEBHOOK_SECRET is set the signature is verified; otherwise we
 * fall back to a plain parse (DEV ONLY — set the secret in production).
 *
 * On `checkout.session.completed` we grant credits exactly once.
 * Returns the parsed event.
 */
export async function handleWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  if (secret) {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } else {
    console.warn('[Stripe] STRIPE_WEBHOOK_SECRET not set — skipping signature verification (DEV ONLY)');
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
  }

  if (event.type === 'checkout.session.completed') {
    await grantFromSession(event.data.object);
  }
  return event;
}

/**
 * Grant credits for a paid Checkout Session, exactly once.
 *
 * Idempotency: we first insert a `payment_transactions` row keyed by the Stripe
 * session id (the table's text PRIMARY KEY). If Stripe re-delivers the webhook,
 * the insert hits a unique-violation (Postgres 23505) and we skip granting,
 * so credits are never doubled.
 */
async function grantFromSession(session) {
  const uid = session.metadata?.uid;
  const productId = session.metadata?.productId;
  const credits = Number(session.metadata?.credits);

  if (!uid || !Number.isFinite(credits) || credits <= 0) {
    console.error('[Stripe] session missing/invalid metadata — skipping grant:', session.id);
    return;
  }

  const supabase = getSupabase();

  const { error: insertError } = await supabase.from('payment_transactions').insert({
    id: session.id,
    uid,
    type: 'stripe',
    status: 'paid',
    amount_try: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      console.log(`[Stripe] session ${session.id} already processed — skipping`);
      return;
    }
    console.error('[Stripe] failed to record payment_transaction:', insertError);
    throw insertError; // make Stripe retry
  }

  const { error: rpcError } = await supabase.rpc('add_wallet_credits', {
    p_uid: uid,
    p_delta: credits,
    p_title: 'Kredi Satın Alındı',
    p_subtitle: `${credits} kredi eklendi • ${productId}`,
    p_type: 'purchase',
  });

  if (rpcError) {
    // Release the dedupe lock so Stripe's retry can grant cleanly instead of
    // hitting the 23505 short-circuit and silently skipping the grant.
    await supabase.from('payment_transactions').delete().eq('id', session.id);
    console.error('[Stripe] add_wallet_credits failed (lock released for retry):', rpcError);
    throw rpcError; // make Stripe retry
  }

  console.log(`[Stripe] Granted ${credits} credits to ${uid} (${productId}, session=${session.id})`);
}
