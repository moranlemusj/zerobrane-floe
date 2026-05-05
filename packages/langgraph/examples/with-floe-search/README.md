# with-floe-search — withFloe middleware demo

A LangGraph graph with a single `search` node that calls a paid search endpoint, wrapped in the `withFloe` middleware.

## Files

| File | What it does |
|---|---|
| `mock-search.ts` | Express server. `POST /search { query }` returns fake results, debits `mock-floe` 0.01 USDC per call. |
| `graph.ts` | LangGraph state graph wrapping `search` with `withFloe`. Two run modes (`mock`, `:real`). |

## Run modes

### Mocked (default — no API keys)

```bash
pnpm --filter floe-langgraph example:with-floe-search
```

What you should see:
- Mock-floe + mock-search spawn on ephemeral ports.
- `[withFloe] preflight_ok` (estimateX402Cost reflection block had no warnings)
- `[withFloe] node_started` → `[withFloe] node_completed`
- `[withFloe] credit_consumed Δ=0.01 USDC` (derived from the credit-remaining diff)
- Two fake search results in the printed state
- Mock-floe ledger: `sessionSpent=10000 creditOut=10000`

### Real (live Floe + your real x402 search endpoint)

```bash
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  MOCK_SEARCH_URL=https://your-x402-search.example.com \
  pnpm --filter floe-langgraph example:with-floe-search:real
```

The graph hits your x402 search endpoint with the Floe API key in the auth chain; the Floe facilitator settles in real USDC.

## What the demo proves

- `withFloe` runs preflight via `estimateX402Cost` and inspects the `reflection` block.
- The inner node runs whether or not preflight succeeded (Floe-side flake never blocks the user's work).
- The before/after `getCreditRemaining` diff is emitted as a `credit_consumed` event with the actual `deltaUsdc`.
