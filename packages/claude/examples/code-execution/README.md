# Floe + Claude Agent SDK — code execution demo

Spawns two in-process mock servers and runs a Claude Agent SDK agent that uses a paid `run_code` tool. The mocks simulate Floe's facilitator settling x402 payments in USDC.

## Files

| File | What it does |
|---|---|
| `mock-floe.ts` | Express server mirroring Floe's live `credit-api`. In-memory state. Exposes the standard `/v1/agents/*` and `/v1/x402/estimate` shapes plus an internal-only `/__mock/debit` endpoint used to simulate facilitator settlement. **The published `FloeClient` never calls `/__mock/*`.** |
| `mock-exec.ts` | Express server simulating an x402-paid code-execution endpoint. On every `POST /exec` it calls mock-floe's `/__mock/debit`. Runs JS in Node's `vm` module — demo only, not a security boundary. |
| `lib.ts` | Shared helpers — boots both mocks on ephemeral ports, exposes the URLs to tests / demos. |
| `run.ts` | The demo orchestrator. Three run modes: `:dry`, default (mock + Claude), `:real` (live Floe + live Claude). |

## Run modes

### Mock-only smoke (no API keys)

```bash
pnpm --filter floe-claude-agent example:agent:dry
```

What you should see:
- Both mock servers spawn on ephemeral ports.
- Spend limit applied (5 USDC).
- Initial credit: `available=0 headroom=10 util=0bps`.
- Preflight outcome: `ok`.
- Mock-floe logs a debit of 50000 raw (0.05 USDC) when mock-exec settles.
- Result: `1+2+...+10 = 55`.
- Credit after: `sessionSpent=0.05 util=50bps`.

This path runs the full Floe wiring (preflight, settlement, ledger updates) without any Anthropic call — useful for CI and for verifying the binding works before plugging in keys.

### Mock + live Claude (Anthropic key only)

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter floe-claude-agent example:agent
```

Same wiring as `:dry`, except the `query()` call goes to live Claude. The agent receives the Floe skill content in its system prompt, sees a `run_code` tool, decides to call it, and reports the result. The preflight hook fires before each call; the borrow-event logger fires after capital-moving Floe MCP tool calls (none in this demo, but it's wired in case you add them).

### Real Floe + live Claude

```bash
FLOE_REAL=1 \
  FLOE_API_KEY=floe_live_... \
  ANTHROPIC_API_KEY=sk-ant-... \
  MOCK_EXEC_URL=https://your-x402-endpoint.example.com \
  pnpm --filter floe-claude-agent example:agent:real
```

Everything points at the production stack. `MOCK_EXEC_URL` is the x402-protected endpoint you want the agent to hit; the Floe facilitator settles the call against your real credit line. **This will move real USDC.** Use a small spend limit and a known-priced endpoint.

## Mock vs Real — what changes?

| Surface | Mock | Real |
|---|---|---|
| Floe `credit-api` base URL | `http://127.0.0.1:<random>` | `https://credit-api.floelabs.xyz` |
| Floe API key | `"mock-key"` (any string) | `floe_live_...` from dev-dashboard.floelabs.xyz |
| x402 endpoint | local Express on `:<random>/exec` | URL of your real x402 service |
| Settlement | mock-floe's `/__mock/debit` (in-memory ledger) | Floe facilitator + on-chain transactions |
| Spend cap | `floeApplySpendLimit({ limit: toUsdc("5") })` | same — Floe enforces server-side either way |

The binding code is unchanged across modes — only the URLs and keys flip via env.
