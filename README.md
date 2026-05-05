# zerobrane-floe-agents

A monorepo of TypeScript packages that make [Floe](https://floe-labs.gitbook.io/docs) — onchain credit for AI agents on Base — usable from the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and [LangGraph](https://github.com/langchain-ai/langgraphjs).

Floe ships a [Coinbase AgentKit binding](https://github.com/Floe-Labs/agentkit-actions) and an [MCP server](https://github.com/Floe-Labs/floe-mcp-server). It does **not** ship a Claude Agent SDK or LangGraph binding. This monorepo fills that gap.

## Packages

| Package | What it does |
|---|---|
| [`@floe-agents/core`](./packages/core) | Typed REST client over Floe's live `credit-api` (`https://credit-api.floelabs.xyz`), USDC value type and helpers, shared domain types. No agent-framework dependencies. |
| [`floe-claude-agent`](./packages/claude) | Floe primitives for the Claude Agent SDK: MCP config helpers, `floeCreditPreflight` PreToolUse hook, `floeBorrowEventLogger` PostToolUse hook, spend-limit setup helpers, Floe Skill markdown. |
| [`floe-langgraph`](./packages/langgraph) | Floe primitives for LangGraph: `withFloe` middleware that wraps any node with credit preflight + spend tracking, plus `floeCodeExecNode` for x402-paid sandboxed code execution. |

`floe-claude-agent` and `floe-langgraph` both depend on `@floe-agents/core`. The two framework bindings are independent — pick one or both.

## Design rule

**Floe is a config concern, not a coding concern.** You write your agent or graph normally; the binding handles credit preflight, spend caps, x402 settlement, and event logging through interception primitives that match the host framework's idioms.

The bindings only call **real** Floe endpoints — no fake `debit` calls, no simulated top-ups. Floe's facilitator handles borrowing implicitly when paid HTTP needs to settle; the binding's job is to *preflight* (will this call succeed?) and to *observe* (how much did this graph step actually consume?).

## How Floe works (the model these bindings assume)

Floe is a credit/borrow protocol with a payment facilitator on Base. Agent flow:

1. Register once: `POST /v1/agents/pre-register` → user signs an on-chain operator delegation against collateral + credit limit → `POST /v1/agents/register` → Floe issues a `floe_live_...` API key.
2. Make paid HTTP calls. Either Floe-proxied (`POST /v1/proxy/fetch`) or direct to an x402-protected URL with the API key in the auth chain. The Floe facilitator handles x402 settlement in USDC, auto-borrowing against the credit line if needed, gas-sponsored.
3. Monitor credit: `GET /v1/agents/credit-remaining`, `GET /v1/agents/loan-state`. Cap spending: `PUT /v1/agents/spend-limit`.

There is no `POST /v1/credit/debit` endpoint. Money moves only via borrow / x402-settle / repay.

## Mock vs Real

Every package ships **both**:

- **Mocked e2e flow** — runs against bundled mock servers, no API keys required, green in CI.
- **Real-key e2e flow** — flips to live Floe + live LLM via env vars. Documented per-package.

The bindings code is unchanged across modes — only URLs and keys flip via env. Each package's README has a "Mock vs Real" section with copy-pasteable commands.

```bash
pnpm install

# Build everything
pnpm -r build

# Test everything (125 mocked tests; real-key tests skip without env)
pnpm -r test

# Typecheck
pnpm -r typecheck

# Demos against bundled mocks (no API keys needed)
pnpm --filter floe-claude-agent  example:agent:dry
pnpm --filter floe-langgraph     example:with-floe-search
pnpm --filter floe-langgraph     example:code-exec
```

For the live-key paths, see each package's README — the env vars are: `FLOE_API_KEY` (Floe), `ANTHROPIC_API_KEY` (Claude demo), `MOCK_SEARCH_URL` / `MOCK_EXEC_URL` (real x402 endpoints).

## Relationship between `withFloe` and `floeCodeExecNode`

```
floe-langgraph
├── withFloe              ← generic middleware: wrap any node
└── floeCodeExecNode      ← composed internally as withFloe(makeX402CallNode(...))
```

`floeCodeExecNode` is a one-import option for the showcase use case (x402-paid sandboxed code exec). For other paid HTTP flows — search, scrape, LLM gateways — wrap your own node with `withFloe`. Both surfaces emit the same `WithFloeEvent` types.

## Status

| | Mocked tests | Build | Demo |
|---|---|---|---|
| `@floe-agents/core` | 60 ✅ | ✅ | n/a |
| `floe-claude-agent` | 45 ✅ | ✅ | `example:agent:dry` ✅ |
| `floe-langgraph` | 20 ✅ | ✅ | `example:with-floe-search` ✅ / `example:code-exec` ✅ |
| **Total** | **125 ✅** | **3/3 ✅** | **3/3 ✅** |

Real-key e2e flows are documented in each package's README and tested via `pnpm test:real` where applicable (`@floe-agents/core` only — the framework-binding real flows require live LLM keys to run end-to-end).

## Repo layout

```
zerobrane-floe-agents/
├── packages/
│   ├── core/                          # @floe-agents/core
│   ├── claude/                        # floe-claude-agent
│   │   └── examples/code-execution/   # mock-floe, mock-exec, agent demo
│   └── langgraph/                     # floe-langgraph
│       └── examples/
│           ├── with-floe-search/      # mock-search, withFloe demo
│           ├── code-exec/             # mock-x402-exec, floeCodeExecNode demo
│           └── lib/                   # shared mock-floe + start helpers
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── README.md
└── LICENSE
```

## License

MIT. See [LICENSE](./LICENSE).
