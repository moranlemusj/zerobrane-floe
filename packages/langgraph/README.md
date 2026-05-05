# floe-langgraph

Floe ([onchain credit for AI agents on Base](https://floe-labs.gitbook.io/docs)) instrumentation middleware for [LangGraph](https://github.com/langchain-ai/langgraphjs).

**One export:** `withFloe` — a middleware that wraps any LangGraph node with credit preflight + spend telemetry. Users do paid HTTP via `client.proxyFetch` (from `@floe-agents/core`) inside their own nodes; `withFloe` adds the observability around it.

> Earlier drafts also exported `floeCodeExecNode` and `makeX402CallNode`. Both were removed once "direct mode" was understood to be a fiction (Floe's facilitator is the only honest agent path) — the node collapsed to a 5-line `withFloe(async (state) => floe.proxyFetch(...))` that didn't earn its own export. The package's job is credit instrumentation; transport is `@floe-agents/core`'s `proxyFetch`.

## Install

```bash
pnpm add floe-langgraph @langchain/langgraph @langchain/core
```

ESM-only, Node 18+. Peer deps: `@langchain/langgraph >= 0.2.0`, `@langchain/core >= 0.3.0`. The `agent/` demo also uses `@langchain/anthropic` (devDep — install separately if you build agents).

## Quick start

```ts
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createFloeClient, withFloe, fromUsdc } from "floe-langgraph";

const floe = createFloeClient({ apiKey: process.env.FLOE_API_KEY });

const State = Annotation.Root({
  query: Annotation<string>(),
  results: Annotation<unknown[]>({ reducer: (_, n) => n, default: () => [] }),
});

// Inner node: pays via Floe's facilitator. Floe borrows USDC against the
// agent's pre-authorized delegation, settles the x402 payment, returns
// the upstream body.
const innerNode = async (state: typeof State.State) => {
  const proxied = await floe.proxyFetch({
    url: "https://your-x402-endpoint.example.com",
    method: "POST",
    body: { query: state.query },
  });
  return { results: (proxied.body as { results: unknown[] }).results };
};

// withFloe wraps the node with preflight + spend telemetry.
const wrapped = withFloe(innerNode, {
  client: floe,
  preflight: { estimate: () => ({ url: "https://your-x402-endpoint.example.com", method: "POST" }) },
  onEvent: (e) => {
    if (e.type === "credit_consumed") {
      console.log(`spent ${fromUsdc(e.deltaUsdc)} USDC`);
    }
  },
});

const graph = new StateGraph(State).addNode("call", wrapped).addEdge(START, "call").addEdge("call", END).compile();
```

## How Floe payment works (model these bindings assume)

The agent registers once with Floe, signing an on-chain operator delegation against its collateral and a credit limit. From then on, Floe's **facilitator** — reachable via `client.proxyFetch` — does the work:

1. Agent calls `floe.proxyFetch({ url, method, body })`.
2. Floe receives, hits the upstream URL, gets `402` with the price.
3. **Floe borrows just enough USDC** against the delegation, pays the upstream, returns the response body.
4. Gas is sponsored by Floe.

So the agent never holds USDC, never signs per-call transactions, and never directly handles x402 payment flows. It just calls `proxyFetch`.

## `withFloe(node, options)`

Wraps an inner node with credit semantics:

1. **Preflight** — reads `client.getCreditRemaining()`. If `options.preflight.estimate(state)` returns a URL, also calls `estimateX402Cost()` and inspects its `reflection` block. Emits one of:
    - `preflight_ok` — affordable
    - `preflight_warning` with `reason: "low_credit"` — utilization above `warnAtUtilizationBps` (default 8000 bps = 80%)
    - `preflight_warning` with `reason: "would_exceed"` — `willExceedAvailable && willExceedHeadroom`
    - `preflight_warning` with `reason: "spend_limit_blocked"` — `willExceedSpendLimit`
2. **Inner node** runs. Errors propagate after firing `error` (phase: `"node"`).
3. **Post-snapshot** (when `trackSpend !== false`, default true) reads `getCreditRemaining()` again and emits `credit_consumed` with `deltaUsdc = after.sessionSpent - before.sessionSpent`.

**Errors during preflight or post-snapshot do not block the inner node.** Floe-side flake never masks the agent's actual work.

```ts
withFloe(node, {
  client: floe,
  preflight: {
    estimate: (state) => state.targetUrl ? { url: state.targetUrl, method: "POST" } : null,
    warnAtUtilizationBps: 7500,
  },
  trackSpend: true,
  reason: "data-fetch",
  onEvent: (e: WithFloeEvent) => { /* telemetry */ },
});
```

The middleware is **mode-agnostic** — works around any node, not just `proxyFetch` ones. If your node consumes Floe credit through any path, the `credit-remaining` diff still tells the truth.

## Demos

Two patterns, two demos. Both use `client.proxyFetch` for the paid HTTP — the only honest agent-side path through Floe.

### `examples/with-floe-search/` — middleware pattern (StateGraph)

A `StateGraph` with a single `search` node that uses `floe.proxyFetch` to hit a paid endpoint, wrapped in `withFloe`. Shows the `withFloe`-wrapping-a-custom-node pattern.

```bash
# Mocked
pnpm --filter floe-langgraph example:with-floe-search

# Real
FLOE_REAL=1 FLOE_API_KEY=floe_live_... MOCK_SEARCH_URL=https://your-x402-search.example.com \
  pnpm --filter floe-langgraph example:with-floe-search:real
```

### `examples/agent/` — ReAct agent with paid tool

`createReactAgent` from `@langchain/langgraph/prebuilt` with a paid `run_code` tool. The tool's handler routes through `floe.proxyFetch`. Claude Haiku 4.5 (via `@langchain/anthropic`) decides when to call the tool. Mirrors the Claude package's agent demo.

```bash
# Mocked Floe + no Anthropic (CI-safe)
pnpm --filter floe-langgraph example:agent:dry

# Mocked Floe + live Anthropic
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter floe-langgraph example:agent

# Real everything
FLOE_REAL=1 FLOE_API_KEY=floe_live_... ANTHROPIC_API_KEY=sk-ant-... \
  MOCK_EXEC_URL=https://your-x402-exec.example.com \
  pnpm --filter floe-langgraph example:agent:real
```

See [`examples/with-floe-search/README.md`](./examples/with-floe-search/README.md) and [`examples/agent/README.md`](./examples/agent/README.md) for per-demo switching matrices.

## Tests

```bash
pnpm test         # 10 mocked tests (no network, no keys)
pnpm typecheck
pnpm build
```

Test breakdown:
- `with-floe.test.ts` — 8 tests covering all preflight branches, error handling, spend-tracking diff math.
- `example-wiring.test.ts` — 2 mocked e2e tests that boot all three mocks (mock-floe, mock-search, mock-x402-exec) and run real LangGraph wiring through them — the `with-floe-search` graph and the `run_code` tool from the agent demo. Neither test invokes Anthropic.

## Design notes

- **One export, intentionally.** The package is credit instrumentation; transport is `@floe-agents/core`'s `proxyFetch`. We don't ship specialized "code exec" or "search" adapters because they'd be opinionated about state-key conventions and response shapes that don't generalize.
- **No fake `debit` API call.** Spend is observed via the `credit-remaining` diff. If real Floe gains a debit endpoint later, we add it; we don't fake it.
- **Errors during Floe calls never block the inner node.** Floe is the authority on affordability — a stale preflight read shouldn't override a real 402 from the actual paid endpoint.
- **`withFloe` works with any node.** It's mode-agnostic; the diff captures whatever consumed credit, regardless of how the spend happened.

## License

MIT.
