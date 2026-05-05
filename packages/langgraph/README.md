# floe-langgraph

Floe ([onchain credit for AI agents on Base](https://floe-labs.gitbook.io/docs)) primitives for [LangGraph](https://github.com/langchain-ai/langgraphjs). Two exports:

- **`withFloe`** — generic middleware that wraps any LangGraph node with credit preflight + spend tracking.
- **`floeCodeExecNode`** — batteries-included node for x402-paid sandboxed code execution, composed internally with `withFloe`.

## Install

```bash
pnpm add floe-langgraph @langchain/langgraph @langchain/core
```

ESM-only, Node 18+. Peer deps: `@langchain/langgraph >= 0.2.0`, `@langchain/core >= 0.3.0`.

## Quick start

```ts
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  createFloeClient,
  floeCodeExecNode,
  fromUsdc,
} from "floe-langgraph";

const floe = createFloeClient({ apiKey: process.env.FLOE_API_KEY });

const State = Annotation.Root({
  code: Annotation<string>(),
  execution: Annotation<unknown>({ reducer: (_, n) => n, default: () => undefined }),
});

const node = floeCodeExecNode<typeof State.State>({
  endpoint: "https://your-x402-exec.example.com",
  apiKey: process.env.FLOE_API_KEY,
  floe: {
    client: floe,
    onEvent: (e) => {
      if (e.type === "credit_consumed") {
        console.log(`spent ${fromUsdc(e.deltaUsdc)} USDC`);
      }
    },
  },
});

const graph = new StateGraph(State)
  .addNode("exec", node)
  .addEdge(START, "exec")
  .addEdge("exec", END)
  .compile();

const result = await graph.invoke({ code: "return 1 + 2;" });
console.log(result.execution); // { ok: true, returned: "3", paidUsdc: "...", ... }
```

## `withFloe(node, options)`

Wraps an inner node with Floe credit semantics. Three phases:

1. **Preflight.** Reads `getCreditRemaining()`. When `options.preflight.estimate(state)` returns a URL, also calls `estimateX402Cost()` and inspects the `reflection` block. Emits one of:
    - `preflight_ok` — affordable
    - `preflight_warning` with `reason: "low_credit"` — utilization above `warnAtUtilizationBps` (default 8000 bps = 80%)
    - `preflight_warning` with `reason: "would_exceed"` — `willExceedAvailable && willExceedHeadroom`
    - `preflight_warning` with `reason: "spend_limit_blocked"` — `willExceedSpendLimit`
2. **Inner node.** Runs whether or not preflight succeeded. Errors propagate after firing `error` (phase: `"node"`).
3. **Post-snapshot.** When `trackSpend !== false` (default true), reads `getCreditRemaining()` again and emits `credit_consumed` with `deltaUsdc = after.sessionSpent - before.sessionSpent`.

**Errors during preflight or post-snapshot do not block the inner node** — Floe-side flake never masks the agent's actual work. The `error` event is emitted with `phase: "preflight"` or `"post"`.

```ts
import { withFloe, type WithFloeEvent } from "floe-langgraph";

const wrapped = withFloe(myNode, {
  client: floe,
  preflight: {
    estimate: (state) => ({ url: state.targetUrl, method: "POST" }),
    warnAtUtilizationBps: 7500,
  },
  trackSpend: true,
  reason: "data-fetch",
  onEvent: (e: WithFloeEvent) => { /* telemetry */ },
});
```

## `floeCodeExecNode(options)`

Composed internally as `withFloe(makeX402CallNode(...))`. Reads `state[inputKey ?? "code"]`, POSTs `{ code, language }` to a paid endpoint, writes the parsed `CodeExecResult` to `state[outputKey ?? "execution"]`.

Two transport modes:

- **Direct mode** (default): `endpoint` is POSTed directly with the agent's Floe API key on the auth chain. The Floe facilitator settles server-to-server.
- **Proxy mode** (`proxy: { useFloeProxy: true }`): routes through `client.proxyFetch` (`POST /v1/proxy/fetch`). Floe handles the 402 dance.

```ts
floeCodeExecNode({
  endpoint: "https://your-x402-exec.example.com",
  proxy: { useFloeProxy: true },              // or omit for direct mode
  apiKey: process.env.FLOE_API_KEY,
  inputKey: "code",                            // default
  outputKey: "execution",                      // default
  language: "javascript",                      // default
  timeoutMs: 30_000,                           // default
  floe: {
    client: floe,
    preflight: { estimate: () => ({ url: "..." }) }, // optional override
    onEvent: (e) => { /* */ },
    trackSpend: true,
  },
});
```

The default preflight extractor estimates against the configured `endpoint`, so you usually don't need to override it.

## Mock vs Real

```bash
# Mocked end-to-end — no API keys, in-process mock servers
pnpm --filter floe-langgraph example:with-floe-search
pnpm --filter floe-langgraph example:code-exec

# Real Floe + your real x402 endpoint (production mode — moves real USDC)
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  MOCK_SEARCH_URL=https://your-x402-search.example.com \
  pnpm --filter floe-langgraph example:with-floe-search:real

FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  MOCK_EXEC_URL=https://your-x402-exec.example.com \
  pnpm --filter floe-langgraph example:code-exec:real
```

See [`examples/with-floe-search/README.md`](./examples/with-floe-search/README.md) and [`examples/code-exec/README.md`](./examples/code-exec/README.md) for the per-demo switching matrices.

## Tests

```bash
pnpm test         # 20 mocked tests (no network, no keys)
pnpm typecheck
pnpm build
```

Test breakdown:
- `with-floe.test.ts` — 8 tests covering all preflight branches, error handling, spend-tracking diff math.
- `x402-call-node.test.ts` — 6 tests for the internal helper (direct + proxy modes, errors, validation).
- `floe-code-exec.test.ts` — 3 tests for the composed node (default extractor, custom keys, proxy mode).
- `example-wiring.test.ts` — 3 mocked e2e tests that boot all three mocks (mock-floe, mock-search, mock-x402-exec) and run actual LangGraph graphs through them.

## Design notes

- **No fake `debit` API call.** Spend is observed via the `credit-remaining` diff, not asserted via a non-existent endpoint. If real Floe gains a debit endpoint later, we add it; we don't fake it.
- **Errors during Floe calls never block the inner node.** Floe is the authority on affordability — a stale preflight read shouldn't override a real 402 from the actual paid endpoint.
- **Proxy mode** is for stacks where the agent doesn't hold the API key directly — Floe handles the 402 dance and proxies the response.
- **`floeCodeExecNode` defaults the preflight URL extractor** to the configured `endpoint`, so users don't have to repeat themselves.

## License

MIT.
