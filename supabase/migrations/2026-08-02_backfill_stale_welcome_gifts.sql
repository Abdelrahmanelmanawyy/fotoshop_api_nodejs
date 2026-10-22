-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostic + repair for accounts stuck by the pre-fix welcome-credit bug
-- ─────────────────────────────────────────────────────────────────────────────
-- Before 2026-07-19/2026-08-02, grant_welcome_credits could insert a
-- 'Welcome Gift' wallet_transactions row without the matching +20 ever
-- landing in wallets.credits (FORCE RLS silently blocked the UPDATE). Those
-- accounts now look "already granted" to the fixed idempotent function, so
-- they will never get credited by simply calling grant_welcome_credits again.
--
-- Run the SELECT first to see who's affected. If it returns rows, run the
-- UPDATE to backfill them (safe: only touches accounts with a real
-- 'Welcome Gift' ledger row whose wallet is missing that credit).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Find affected accounts: has a 'Welcome Gift' transaction, but their
--    current wallet balance is less than the sum of all transactions on
--    record (i.e. the ledger says +20 happened but the balance never moved).
SELECT
  w.id AS user_id,
  au.email,
  w.credits AS current_balance,
  COALESCE(SUM(wt.delta), 0) AS ledger_total
FROM public.wallets w
JOIN auth.users au ON au.id = w.id
LEFT JOIN public.wallet_transactions wt ON wt.wallet_id = w.id
WHERE EXISTS (
  SELECT 1 FROM public.wallet_transactions g
  WHERE g.wallet_id = w.id AND g.type = 'gift' AND lower(trim(g.title)) = 'welcome gift'
)
GROUP BY w.id, au.email, w.credits
HAVING w.credits < COALESCE(SUM(wt.delta), 0);

-- 2) Backfill: bring each affected wallet's balance up to match its own
--    ledger total (does not touch anyone whose balance already matches).
UPDATE public.wallets w
SET credits = ledger.ledger_total,
    updated_at = now()
FROM (
  SELECT wallet_id, SUM(delta) AS ledger_total
  FROM public.wallet_transactions
  GROUP BY wallet_id
) ledger
WHERE w.id = ledger.wallet_id
  AND w.credits < ledger.ledger_total;
