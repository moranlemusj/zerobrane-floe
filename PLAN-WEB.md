# PLAN — Web dashboard

> **Retrospective.** This file was authored after the dashboard
> shipped. It applies the `/plango`-style "phases broken into tasks
> with TDD where there's a clean test surface" framework to work that
> was originally built without it. The PRD
> ([floe-dashboard-PRD.md](./floe-dashboard-PRD.md)) drove the
> original phasing; this file decomposes those phases into tasks and
> notes the test coverage added in this branch.

## Phase 2 — Scaffolding

- [x] Next.js 16 skeleton (`apps/web/`) with Tailwind 4 + Neon-backed `/api/healthz`
- [x] Wire vitest harness (added retroactively in this branch)

## Phase 4 — Dashboard core

- [x] Phase 4a: KPI header + filterable loan table on `/`
- [x] Phase 4b: `/markets` page (loans grouped by market) + `/loan/:loanId` detail page
- [x] Initial conditions + close timestamps + interest paid surfaced in detail view

**Test coverage added retroactively:** format helpers
(`tokenInfo`, `formatAmount`, `toHumanNumber`, `shortAddress`,
`healthBand`). These are the display-layer primitives every page
leans on — pinning them catches LTV-band mapping regressions and
raw-uint256 formatting bugs.

## Phase 5 — Chatbot

- [x] `/chat` page with streaming UI (AI SDK)
- [x] `/api/chat` route with read-only DB tools (loan-teller, market lookup, oracle freshness)
- [x] Curl preview for each tool call

## Phase 6 — Wallet sign-in + /me

- [x] RainbowKit + EIP-191 sign-in
- [x] iron-session cookie
- [x] `/me` route gated by cookie

## Phase 7 — Polish + deploy

- [x] Shared `SiteHeader` with mobile-responsive nav
- [x] Global error boundary
- [x] README rewrite — dashboard front-and-center
- [x] Chatbot hardening (tool internals hidden from UI; tool limits raised; tool inspector restored)
- [x] Deploy: Neon → Alchemy → Railway → Vercel

## Phase 8 — Tier 1 additions

- [x] **1A**: Per-address page (`/address/:addr`) — borrower + lender + operator pivot
- [x] **1B**: Activity feed (`/activity`) — paginated reverse-chrono stream of every matcher event, filterable by event type
- [x] **1C**: Protocol-wide stress test (`/stress`) — URL-driven sliders (?weth=20&btc=15) compute "if WETH drops 20% and BTC drops 15%, N loans become liquidatable, $X principal at risk"

**Test coverage added retroactively (Tier 1C only — 1A/1B are
wiring-heavy with no clean pure-function targets):** 6 tests covering
`stressLoan` + `stressAll` in `apps/web/src/lib/stress.ts`. Fixtures
use realistic loan shapes (WETH-collateralized USDC, ~70% baseline
LTV, -30% WETH push exceeds the 90% liq threshold). Pins the math
against regression.

## Test surface — total

2 test files, 26 tests covering format helpers + stress math. Run with:

```
pnpm --filter @floe-dashboard/web test
```
