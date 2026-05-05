# code-exec — floeCodeExecNode demo

A single-node LangGraph graph that uses the batteries-included `floeCodeExecNode` to execute JS via an x402-paid endpoint.

## Files

| File | What it does |
|---|---|
| `mock-x402-exec.ts` | Express server. `POST /exec { code }` runs JS in Node's `vm` after debiting mock-floe 0.05 USDC. **Demo only — `vm` is not a security boundary.** |
| `graph.ts` | LangGraph state graph using `floeCodeExecNode`. Two run modes (`mock`, `:real`). |

## Run modes

### Mocked (default — no API keys)

```bash
pnpm --filter floe-langgraph example:code-exec
```

What you should see:
- Mock-floe + mock-x402-exec spawn on ephemeral ports.
- `[floeCodeExec] preflight_ok`
- `[mock-floe] debit 50000 (reason: mock-x402-exec)`
- `[floeCodeExec] credit_consumed Δ=0.05 USDC`
- Code result: `5050` (sum 1..100)
- Mock-floe ledger: `sessionSpent=50000 creditOut=50000`

### Real (live Floe + a real x402 code-exec endpoint)

```bash
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  MOCK_EXEC_URL=https://your-x402-exec.example.com \
  pnpm --filter floe-langgraph example:code-exec:real
```

Picks an x402 code-execution provider (e.g., x402engine, Run402, Spraay — pick one and pass its URL). The Floe facilitator settles in real USDC.

## Two transport modes

`floeCodeExecNode` supports two ways of routing the paid HTTP:

```ts
// Direct mode (default): agent's API key on the auth chain
floeCodeExecNode({
  endpoint: "https://your-x402-exec.example.com",
  apiKey: process.env.FLOE_API_KEY,
  floe: { client: floe },
});

// Proxy mode: route through Floe's POST /v1/proxy/fetch
floeCodeExecNode({
  endpoint: "https://your-x402-exec.example.com",
  proxy: { useFloeProxy: true },
  floe: { client: floe },
});
```

The mocked e2e tests cover both paths.
