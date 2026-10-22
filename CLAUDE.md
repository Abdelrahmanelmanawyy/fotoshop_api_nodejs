# fotoshop_api_nodejs — backend

Plain JavaScript (ESM), Express 4, `@supabase/supabase-js` with the service-role key, Node's built-in test runner.
Do not introduce TypeScript, Prisma, Fastify or another test framework.

## Layout
- `src/index.js` — app wiring: trust proxy, security headers, CORS, route mounting, env warnings, sweeper start, shutdown.
- `src/presentation/` — HTTP only. `routes/*.js` (process, biometric, paytr, stripe, iap, coupons, pricing);
  `middleware/` `auth.js` (`authenticate`, `resolveUserId`), `rateLimit.js`, `requireSupabase.js`.
- `src/domain/` — business logic: `orderService` (claim → model → refund), `orderSweeper`, `orderTiming`, `iapService`,
  `stripeService`, `paytrService`, `couponService`, `printPricingService`, `spendGuard`, `biometricService`.
- `src/data/` — integrations: `database.js` (orders, claim, payment check, refunds), Replicate, OpenAI, PhotoXBox, stores, storage.
- `src/composition/container.js` — dependency wiring for `orderService`. `src/core/` — `validation.js`, `timeout.js`.

## Rules
- Money/credit work: load the `money-path` skill. SQL: load `db-migration`. Both are mandatory, not optional reading.
- Identity comes from the JWT: `resolveUserId(req, req.body.uid)`. New user-facing routes mount `authenticate` + a rate limiter.
- Check `{ error }` on every Supabase call that writes or that a decision depends on.
- Validate input at the route (`core/validation.js`, explicit type checks). Never trust client prices, amounts, uids or model names.
- 5xx responses: `{ error: "<code>" }` only; log details with a `[Area]` prefix, never secrets.
- Long work is async (202 + realtime + sweeper). Do not hold requests open for model calls.

## Commands
`npm test` (all of `test/*.test.js`) · `npm run dev:watch` · prod: EC2, pm2 `fotoshop-api`, branch `main` (deploy only when asked).
Env reference: `.env.example`. Key flags: `REQUIRE_AUTH`, `IAP_DEV_MODE` (dev only), `TRUST_PROXY`, `STRIPE_WEBHOOK_SECRET`.
