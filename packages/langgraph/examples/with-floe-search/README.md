# with-floe-search — withFloe middleware demo

A LangGraph `StateGraph` with a single `search` node that calls a paid x402 search endpoint via Floe's facilitator. The node is wrapped in the `withFloe` middleware for credit preflight + spend telemetry.

## Files

| File | What it does |
|---|---|
| `mock-search.ts` | Plain paid-search endpoint. `POST /search { query }` returns hand-fabricated results. **Performs no settlement of its own** — settlement happens at `mock-floe`'s `/v1/proxy/fetch` upstream. |
| `graph.ts` | The graph. `withFloe(searchNode)` where `searchNode` calls `floe.proxyFetch`. Two run modes (`mock`, `:real`). |

## Run modes

### Mocked (default — no API keys)

```bash
pnpm --filter floe-langgraph example:with-floe-search
```

What you should see:
- mock-floe + mock-search spawn on ephemeral ports.
- `[withFloe] preflight_ok` (the `estimateX402Cost` reflection block had no warnings)
- `[mock-floe] proxy_fetch POST .../search (price 10000) — sessionSpent=10000`
- `[withFloe] credit_consumed Δ=0.01 USDC` (derived from the credit-remaining diff)
- Two fake search results in `state.results`.

### Real (live Floe + your real x402 search endpoint)

```bash
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  MOCK_SEARCH_URL=https://your-x402-search.example.com \
  pnpm --filter floe-langgraph example:with-floe-search:real
```

The graph hits your x402 search endpoint via Floe's `/v1/proxy/fetch`; the Floe facilitator settles in real USDC on Base.

## What this demo proves

- `withFloe` runs preflight via `estimateX402Cost` and inspects the `reflection` block.
- The inner node uses `floe.proxyFetch` — Floe's facilitator does the actual paying.
- The before/after `getCreditRemaining` diff is emitted as a `credit_consumed` event with the actual `deltaUsdc` settled.
- Settlement is observed in mock-floe's ledger.

For the LLM-driven version (an agent that decides when to call paid tools), see [`../agent/`](../agent/).
