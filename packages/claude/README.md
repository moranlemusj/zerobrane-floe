# floe-claude-agent

Floe ([onchain credit for AI agents on Base](https://floe-labs.gitbook.io/docs)) primitives for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

You write your `query()` call normally and add Floe at the options layer:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  createFloeClient,
  floeApplySpendLimit,
  floeCreditPreflight,
  floeBorrowEventLogger,
  floeMcpHttp,
  floeMcpServers,
  floeSystemPrompt,
  toUsdc,
} from "floe-claude-agent";

const floe = createFloeClient({ apiKey: process.env.FLOE_API_KEY });
await floeApplySpendLimit({ client: floe, limit: toUsdc("10") });

await query({
  prompt: "Find the cheapest x402 search API and call it.",
  options: {
    systemPrompt: floeSystemPrompt(),
    mcpServers: floeMcpServers(floeMcpHttp({ apiKey: process.env.FLOE_API_KEY! })),
    hooks: {
      PreToolUse: [
        floeCreditPreflight({
          client: floe,
          estimateUrlFromInput: (toolName, input) => {
            const i = input as { url?: string };
            return i.url ? { url: i.url } : null;
          },
          onPreflight: (o) => console.log("preflight:", o.kind),
        }),
      ],
      PostToolUse: [
        floeBorrowEventLogger({ onEvent: (e) => console.log("borrow:", e) }),
      ],
    },
  },
});
```

## Install

```bash
pnpm add floe-claude-agent @anthropic-ai/claude-agent-sdk zod
```

ESM-only, Node 18+. Peer deps: `@anthropic-ai/claude-agent-sdk >= 0.2.0`, `zod` (optional).

## What it gives you

### MCP config helpers — `floeMcpHttp`, `floeMcpStdio`, `floeMcpServers`

Wire Floe's MCP server into `query()` at the right key (`floe`):

```ts
const servers = floeMcpServers(floeMcpHttp({ apiKey: "floe_live_..." }));
// → { floe: { type: "http", url: "https://mcp.floelabs.xyz/mcp", headers: { Authorization: "..." } } }
```

Stdio variant for local agents that prefer subprocess transport:

```ts
floeMcpStdio({ apiKey: "floe_live_..." })
// → { type: "stdio", command: "npx", args: ["-y", "@floelabs/mcp-server"], env: { FLOE_API_KEY: "..." } }
```

Plus four tool-name lists (with the SDK's `mcp__floe__` prefix already applied) for hook matchers:

| Constant | Count | What it covers |
|---|---|---|
| `FLOE_READ_TOOLS` | 12 | `get_markets`, `get_loan`, `get_loan_health`, etc. |
| `FLOE_WRITE_TOOLS` | 9 | `create_lend_intent`, `repay_loan`, `liquidate_loan`, etc. |
| `FLOE_CAPITAL_MOVING_TOOLS` | 6 | Subset of write tools that finalize capital movement, plus `broadcast_transaction`. |
| `FLOE_AGENT_AWARENESS_TOOLS` | 9 | `get_credit_remaining`, `set_spend_limit`, `estimate_x402_cost`, etc. |
| `FLOE_TOOLS_ALL` | — | The glob `mcp__floe__*` for matching every Floe MCP tool. |

### `floeCreditPreflight` — PreToolUse hook

Reads the live Floe credit state before paid tool calls. **Never blocks** the call — the facilitator is the source of truth for affordability, so we let real 402s surface from real endpoints rather than vetoing on stale preflight reads.

When you supply `estimateUrlFromInput`, the hook calls `POST /v1/x402/estimate` and inspects the `reflection` block:

| `reflection.willExceed*` flag set | Outcome emitted |
|---|---|
| `willExceedSpendLimit` | `spend_limit_blocked` |
| `willExceedAvailable && willExceedHeadroom` | `would_exceed` |
| neither | `ok` |

When you don't supply an extractor, it falls back to a plain `getCreditRemaining()` and emits `low_credit_warning` above 80% utilization (configurable via `warnAtUtilizationBps`).

```ts
floeCreditPreflight({
  client: floe,
  estimateUrlFromInput: (toolName, input) => {
    if (toolName === "WebFetch") {
      const i = input as { url?: string };
      return i.url ? { url: i.url } : null;
    }
    return null;
  },
  onPreflight: (o) => { /* telemetry */ },
  onError: (err) => { /* Floe-side issues never throw into the SDK */ },
});
```

The default matcher is `^(?!mcp__floe__).+$` — every tool except Floe's own MCP tools (prevents recursion / wasted preflight on cheap reads).

### `floeBorrowEventLogger` — PostToolUse hook

Emits a structured `BorrowEvent` after any capital-moving Floe MCP tool call:

```ts
floeBorrowEventLogger({
  onEvent: (e) => {
    // e.type ∈ "borrow" | "repay" | "match" | "liquidate" | "collateral_added" | "collateral_withdrawn"
    // e.toolName, e.details, e.timestamp
  },
});
```

Default matcher targets `FLOE_CAPITAL_MOVING_TOOLS`. Override `matcher` if you want broader/narrower coverage.

### `floeApplySpendLimit` / `floeClearSpendLimit` / `floeGetSpendLimit`

Setup helpers — **not hooks**. Floe enforces the cap server-side, so a misbehaving hook can't exceed it. Apply once before `query()`, clear when done.

```ts
await floeApplySpendLimit({ client: floe, limit: toUsdc("10") });
// run your agent...
await floeClearSpendLimit(floe);
```

### `FLOE_SKILL_MARKDOWN` and `floeSystemPrompt`

`FLOE_SKILL_MARKDOWN` is the Floe skill content — it teaches the agent the facilitator model (no manual top-ups), the reflection-flag reading pattern for `estimate_x402_cost`, and what not to surface to users unprompted.

`floeSystemPrompt()` returns a value compatible with the SDK's `options.systemPrompt`, defaulting to the `claude_code` preset with the Floe content appended:

```ts
options: { systemPrompt: floeSystemPrompt() }
options: { systemPrompt: floeSystemPrompt({ append: "Extra rules..." }) }
options: { systemPrompt: floeSystemPrompt({ withClaudeCodePreset: false }) } // raw string
```

## Mock vs Real

The `examples/code-execution/` directory ships a self-contained demo with two run modes:

```bash
# Mocked end-to-end — no API keys, in-process mock servers
pnpm --filter floe-claude-agent example:agent:dry

# Live Claude + mocked Floe (one key)
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter floe-claude-agent example:agent

# Live Floe + live Claude (production mode — moves real USDC)
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  ANTHROPIC_API_KEY=sk-ant-... \
  MOCK_EXEC_URL=https://your-x402-endpoint.example.com \
  pnpm --filter floe-claude-agent example:agent:real
```

See [`examples/code-execution/README.md`](./examples/code-execution/README.md) for the full mock-vs-real switching matrix.

## Tests

```bash
pnpm test         # 45 mocked tests (no network, no keys)
pnpm typecheck
pnpm build
```

The mocked test suite includes a full e2e wiring test that boots both mock servers in-process and verifies the preflight hook, mock-floe debit ledger, and borrow-event logger end-to-end (`src/__tests__/example-wiring.test.ts`).

## Design notes

- **Hooks never block tool execution.** The facilitator is authoritative for affordability — preflight is observation, not enforcement. If you want a hard veto, set a spend limit (server-side enforced).
- **No manual borrowing.** The Floe facilitator handles borrowing implicitly when paid HTTP needs to settle. Hooks read state and emit events; they do not call `instant_borrow` on every paid call.
- **No client-side debit tracking.** `withFloe`-style spend tracking lives in the LangGraph binding; for Claude, the `floeBorrowEventLogger` covers the explicit-action case.
- **Spend limit is server-side.** `floeApplySpendLimit` is a one-shot setup call, not a hook. Floe enforces the cap, so client-side drift can't matter.

## License

MIT.
