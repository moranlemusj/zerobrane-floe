# LangGraph + Floe — agent demo

A `createReactAgent` ReAct loop with one paid tool: `run_code`. The tool's handler routes through Floe's facilitator (`floe.proxyFetch`) — Floe debits the agent's credit line, pays the x402 endpoint, returns the result. The LLM (Claude Haiku 4.5 via `@langchain/anthropic`) decides when to call the tool.

This mirrors the Claude package's agent demo on the LangGraph side.

## Files

| File | What it does |
|---|---|
| `mock-x402-exec.ts` | Plain x402-paid code-exec endpoint. Runs JS in Node's `vm`, returns `{ ok, stdout, stderr, returned, ... }`. **Performs no settlement of its own** — settlement happens at `mock-floe`'s `/v1/proxy/fetch` upstream. |
| `graph.ts` | The agent: `createReactAgent` + ChatAnthropic + a paid `run_code` tool. Three run modes (`mock`, `:dry`, `:real`). |

## Run modes

### Mocked, no Anthropic call (`:dry`)

```bash
pnpm --filter floe-langgraph example:agent:dry
```

What you should see:
- mock-floe + mock-x402-exec spawn on ephemeral ports.
- Spend cap applied (1 USDC).
- The tool is invoked once with hand-coded JS (`return 1+2+...+10`).
- `[mock-floe] proxy_fetch POST .../exec (price 50000) — sessionSpent=50000`
- `[demo] dry tool result: {"ok":true,...,"returned":"55"}`
- `[demo] events: run_code: status=200 Δ=0.05 USDC`
- mock-floe ledger reflects the 50000 raw debit.

This path runs the full Floe wiring (preflight, settlement, tool round-trip) without any Anthropic call — useful for CI and for verifying setup before plugging keys in.

### Mocked Floe + live Anthropic

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter floe-langgraph example:agent
```

The agent receives a math prompt, decides to call `run_code`, the tool POSTs through mock-floe → mock-x402-exec, returns the result, agent answers. Spend events log per tool call.

### Real Floe + real Anthropic + real x402 endpoint

```bash
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  ANTHROPIC_API_KEY=sk-ant-... \
  MOCK_EXEC_URL=https://your-x402-exec.example.com \
  pnpm --filter floe-langgraph example:agent:real
```

Everything points at production. The agent's credit delegation funds the x402 calls; Floe's facilitator settles in real USDC. **Will move real funds.** Use a small spend limit and a known-priced endpoint.

## Mock vs Real switching matrix

| Surface | Mock (default) | Real (`FLOE_REAL=1`) |
|---|---|---|
| Floe `credit-api` base URL | `http://127.0.0.1:<random>` | `https://credit-api.floelabs.xyz` (or `FLOE_BASE_URL`) |
| Floe API key | `"mock-key"` (any string) | `floe_live_...` from dev-dashboard.floelabs.xyz |
| x402 exec endpoint | local Express on `:<random>/exec` | `MOCK_EXEC_URL` (your real x402 service) |
| Settlement | mock-floe's `/v1/proxy/fetch` (in-memory ledger) | Floe facilitator + on-chain transactions |
| Anthropic model | `claude-haiku-4-5` (override via `ANTHROPIC_MODEL`) | same |
| Spend cap | `1 USDC` via `floe.setSpendLimit` | not auto-applied — set one yourself if you want |

The agent code is unchanged across modes — only URLs and keys flip via env.

## Why hand-instrument the tool instead of using `withFloe`?

`withFloe` wraps state-graph nodes (`(state) => Partial<state>`). LangGraph tools have a different shape (input → string-or-structured output). For the demo we hand-roll the credit-remaining diff inside the tool handler — three lines, easy to read. If you're building a custom StateGraph rather than a ReAct agent, see `examples/with-floe-search/graph.ts` for the `withFloe`-wrapping-a-node pattern instead.
