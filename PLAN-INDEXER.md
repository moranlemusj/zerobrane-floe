# PLAN — Indexer

## Phase 2 — Scaffolding

- [x] Extend pnpm workspace to include `apps/*`
- [x] Add `@floe-dashboard/data` package — Drizzle schema (loans, markets, events, oracles, indexer_state) + Neon HTTP client
- [x] Add `apps/indexer/` skeleton — Neon ping + state seed
- [x] Wire vitest harness

## Phase 3 — Indexer core

- [x] ABI resolver via Sourcify (matcher proxy → impl walk; lendingViews; logicsManager delegatecall events surface at matcher address)
- [x] viem clients with WSS preference + HTTP fallback (`buildClientsWithFallback`)
- [x] Markets sync from Floe REST `/v1/markets`
- [x] Event upsert into `events` table; loan_id extraction from topic[1] where applicable
- [x] Multicall3-batched loan hydration via `getLoan(id)` + interest/LTV/underwater views
- [x] Loan discovery via `getLoan()` probe (binary-search the highest valid id)
- [x] Chunked event backfill from `lastBlock` → head with Alchemy free-tier-aware chunk sizing
- [x] Chainlink oracle subscriptions over WSS; resolve proxy → underlying aggregator at boot
  - The proxy doesn't emit events — the underlying does. `resolveUnderlyingAggregator` walks proxy → underlying once at subscribe-time so the live subscriber attaches to the right address.
- [x] Initial oracle snapshot + persist on `AnswerUpdated`
- [x] Live subscriptions: matcher events + per-oracle ticks → hydrate affected loans
- [x] 10-minute reconciliation pass as crash-recovery safety net

**Test coverage:** `resolveUnderlyingAggregator` — mocks viem's
`readContract` and asserts the proxy walk returns the current
underlying. Pins a class of silent-oracle bugs (subscriber attached
to proxy → no events ever).

## Phase 8 — Tier 1 additions (indexer side)

The Phase 8 build was mostly web-side (see [PLAN-WEB.md](./PLAN-WEB.md)).
Indexer-side work: market enrichment for markets referenced by loans
but absent from Floe's `/v1/markets` REST API.

- [x] `enrichUnknownMarkets` — on-chain `viewMarket()` fallback for non-curated markets

## Post-Phase-8 — Production hardening

Bugs surfaced after the dashboard went live with real loan activity.
Each fix lands with a paired unit test pinning the invariant.

- [x] **Bug**: Indexer crashes on transient Neon `fetch failed` inside viem `onLogs` callbacks
  - Fix: `d34d7cc fix(indexer): don't crash on transient Neon fetch failures`
  - **Test:** `safelyRun` — verifies error swallowing + label-tagged logging

- [x] **Bug**: New loans show `—` for BORROWED / COLLATERAL POSTED for up to 10 min after match
  - Fix: `0e2016b fix(indexer): backfill initial conditions in the live matcher handler`
  - **Test:** `containsNewMatch` — truth table for the LogIntentsMatched dispatch

- [x] **Bug**: `initial_principal_raw` captures net-disbursed (4.95) instead of matched principal (5.00)
  - Fix: `b6e9610 fix(indexer): initial principal = matched principal, not net-disbursed`
  - Re-ran one-shot backfill against production: 80 loans corrected
  - **Test:** `extractAmounts` — fixture-based, asserts matched-principal invariant against a synthetic match-tx receipt

- [x] **Bug**: USDC/USDC loans never re-hydrate (`accrued_interest_raw` frozen at 0)
  - Fix: `38ad894 fix(indexer): blanket-refresh active loans in reconcile loop`
  - **Test:** `allActiveLoanIds` — Drizzle chain shape + bigint return

## Test surface — total

5 test files, 16 tests covering the indexer's pure-function /
helper surface. Run with:

```
pnpm --filter @floe-dashboard/indexer test
```

A green run pins the bug classes above against regression. An edit
that, say, reverts `extractAmounts` back to `to === borrower` will
trip the assertion immediately.
