# Floe — Loan Dashboard + Agent Bindings

A live, chain-indexed loan dashboard for [Floe](https://floe-labs.gitbook.io/docs) — the onchain credit protocol on Base — plus the TypeScript packages that make Floe usable from the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and [LangGraph](https://github.com/langchain-ai/langgraphjs).

**Live demo:** https://zerobrane-floe-web.vercel.app

## What's in this repo

```
zerobrane-floe/
├── apps/
│   ├── web/        Next.js 16 dashboard (Vercel)
│   └── indexer/    Long-running Node service: chain → Postgres (Railway)
└── packages/
    ├── data/       Shared Drizzle schema + Neon client
    ├── core/       @floe-agents/core    — typed REST client
    ├── claude/     floe-claude-agent    — Claude Agent SDK binding
    └── langgraph/  floe-langgraph       — LangGraph middleware + agent
```

The **dashboard** (`apps/`) is the headline. The **agent bindings** (`packages/core`, `packages/claude`, `packages/langgraph`) are the foundation it builds on.

---

## The dashboard

### Pages

| Route | What it does |
|---|---|
| `/` | All loans table — 13 columns, every numeric/date column sortable, status filter dropdown, KPI strip, last-reconciled badge |
| `/loan/:id` | Per-loan detail with "At origination" + "Current state" stat blocks, schedule (matched / closed / held-for / % of term), event timeline with collateral amounts, stress simulator with live oracle freshness |
| `/markets` | Per-market aggregates + Chainlink oracle prices with per-feed publish freshness |
| `/me` | Personal view — wallet sign-in (EIP-191, no RainbowKit), session-gated loan list filtered to the connected address |
| `/chat` | Natural-language Q&A over the indexer DB + Floe REST. 8 tools incl. the **loan teller** that constructs the exact `curl` you'd run to borrow on Floe — preview-only, never executes |

### Architecture

```
        Base mainnet                  Neon Postgres                  Vercel
       ┌─────────────┐               ┌─────────────┐              ┌─────────────┐
       │  Matcher    │               │             │              │  Next.js 16 │
       │   proxy     │               │   loans     │              │             │
       │             │  events       │   events    │  RSC reads   │  /          │
       │  Chainlink  │ ─────────►   │   markets   │ ─────────►  │  /loan/:id  │
       │  ETH/USD    │  (WebSocket  │   oracles   │              │  /markets   │
       │  Chainlink  │   + 10-min   │   indexer_  │              │  /me        │
       │  BTC/USD    │   reconcile)  │     state   │              │  /chat      │
       └─────────────┘               └─────────────┘              └─────────────┘
              ▲                              ▲                          │
              │ view reads                   │ writes                   │ tool calls
              │ (latestRoundData,            │                          │
              │  getLoan, getCurrentLtvBps)  │                          ▼
              │                              │                   Gemini 2.5 Flash
              │                              │                   (chatbot LLM)
              │                              │
              └──────────────────┐    ┌──────┘
                                 │    │
                              ┌──┴────┴──┐
                              │  Indexer │  Long-running daemon (Railway)
                              │  Node    │  • viem WebSocket subs on the
                              │  + viem  │    matcher proxy + Chainlink
                              │  + tsx   │    underlyings
                              │          │  • 10-min reconcile timer
                              └──────────┘  • initial-conditions backfill
                                            • close-snapshot decode
```

Reads are **chain-primary**: `getLoan()`, `getCurrentLtvBps()`, `isLoanUnderwater()` over Multicall3, hydrated into Postgres.

Some derived data isn't on chain or in events directly — Floe's matcher emits hash-only events, doesn't preserve close metadata after repay, etc. The indexer recovers those from transaction receipts and the matcher's own snapshot events. Result: the dashboard shows initial conditions, total interest paid, time-held, and "early/on-time/overdue" badges that the protocol itself doesn't expose.

### Run locally

Requirements: Node 20+, pnpm, a Neon Postgres URL, an Alchemy API key, a Google Gemini API key.

```bash
git clone https://github.com/moranlemusj/zerobrane-floe.git
cd zerobrane-floe
pnpm install

# .env at repo root
cat > .env <<'ENV'
NEON_DATABASE_URL=postgres://...           # required by web + indexer
ALCHEMY_API_KEY=...                        # required by indexer
GOOGLE_API_KEY=...                         # required by /chat
IRON_SESSION_PASSWORD=...                  # required by /me; ≥ 32 chars (openssl rand -hex 32)
FLOE_LIVE_API_KEY=floe_live_...            # optional; only used by /chat's Floe REST tool
ENV

# One-time: push the Drizzle schema to your Neon DB
pnpm --filter @floe-dashboard/data exec drizzle-kit push --force

# Dev: indexer (one terminal) + web (another)
cd apps/indexer && pnpm dev
cd apps/web     && pnpm dev   # http://localhost:3000
```

The indexer will discover loans via `getLoan(1..N)` probe + backfill events from the configured `INITIAL_LOOKBACK_BLOCKS` window, hydrate everything, and start live WebSocket subscriptions. ~30s on a fresh DB to the first usable dashboard render.

### Deploy

| Layer | Where | Notes |
|---|---|---|
| Postgres | Neon | Created upfront. Schema pushed via Drizzle. |
| Web app | Vercel (auto from `main`) | Set `NEON_DATABASE_URL`, `IRON_SESSION_PASSWORD`, `GOOGLE_API_KEY` in Vercel project env. Root directory: `apps/web`. |
| Indexer | Railway (auto from `main`) | Build: `pnpm install --frozen-lockfile && pnpm --filter @floe-dashboard/indexer... build`. Start: `pnpm --filter @floe-dashboard/indexer start`. Env: `NEON_DATABASE_URL`, `ALCHEMY_API_KEY`, `LOG_LEVEL=info`. Restart policy: Always. |

Both targets watch `main` — `git push` triggers auto-redeploy of whichever target's files changed.

### Acceptance / what works

- ✅ All 80 historical loans indexed from the matcher's deployment block. Initial principal/collateral derived from match-tx receipts. Close timestamps + total interest paid recovered from the matcher's snapshot events.
- ✅ Live updates via Chainlink `AnswerUpdated` subscription on the **underlying aggregator** (not the proxy — see [discovery notes](./discovery-report.md)). Oracle ticks fire every 15-30 min and trigger re-hydration of every active loan with that collateral.
- ✅ Wallet sign-in via EIP-191 + iron-session cookie. No RainbowKit (saves ~150 KB client JS).
- ✅ Chatbot with 8 tools incl. the loan teller. Refuses to execute borrows; returns curl + LTV math + warnings.
- ✅ `pnpm -r typecheck && pnpm -r build && pnpm -r test` clean across the monorepo.

---

## The agent bindings

These exist because Floe ships [Coinbase AgentKit](https://github.com/Floe-Labs/agentkit-actions) and [MCP](https://github.com/Floe-Labs/floe-mcp-server) bindings but no Claude Agent SDK or LangGraph binding. Each is published, tested against both mocks and the live Floe API.

| Package | What it is |
|---|---|
| [`@floe-agents/core`](./packages/core) | Typed REST client over `https://credit-api.floelabs.xyz`. USDC value type, x402 helpers, shared domain types. No agent-framework dependencies. |
| [`floe-claude-agent`](./packages/claude) | Floe primitives for the Claude Agent SDK: MCP config, `floeCreditPreflight` PreToolUse hook, spend-limit setup, Floe Skill markdown. |
| [`floe-langgraph`](./packages/langgraph) | One export — `withFloe` — that wraps any LangGraph node with credit preflight + spend telemetry. Two demos: `with-floe-search` (StateGraph + middleware) and `agent` (`createReactAgent` with a paid `run_code` tool). |

**Design rule**: Floe is a config concern, not a coding concern. The bindings call only **real** Floe endpoints — no fake `debit` calls, no simulated top-ups. Floe's facilitator handles borrowing implicitly when paid HTTP needs to settle; the binding's job is to *preflight* and to *observe*.

```bash
pnpm install
pnpm -r build
pnpm -r test           # 115+ mocked tests
pnpm -r typecheck

# Demos against bundled mocks (no API keys needed)
pnpm --filter floe-claude-agent  example:agent:dry
pnpm --filter floe-langgraph     example:with-floe-search
pnpm --filter floe-langgraph     example:agent:dry
```

For real-key flows, see each package's own README — env vars are `FLOE_API_KEY`, `ANTHROPIC_API_KEY`, `MOCK_SEARCH_URL` / `MOCK_EXEC_URL`.

---

## License

MIT. See [LICENSE](./LICENSE).
