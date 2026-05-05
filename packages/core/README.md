# @floe-agents/core

Typed REST client over Floe's [`credit-api`](https://floe-labs.gitbook.io/docs/developers/credit-api), USDC value type and helpers, shared domain types used by the Claude and LangGraph bindings.

No agent-framework dependencies. Use it directly, or as the substrate behind [`floe-claude-agent`](../claude) and [`floe-langgraph`](../langgraph).

## Install

```bash
pnpm add @floe-agents/core
# or: npm i / yarn add
```

ESM-only, Node 18+. `fetch` is read from `globalThis` (Node 18+ has it native; pass your own via the `fetch` option on older runtimes).

## Quick start

```ts
import { createFloeClient, toUsdc, fromUsdc } from "@floe-agents/core";

const floe = createFloeClient({
  apiKey: process.env.FLOE_API_KEY, // floe_live_...
});

const remaining = await floe.getCreditRemaining();
console.log(`Available: ${fromUsdc(remaining.available)} USDC`);
console.log(`Headroom to auto-borrow: ${fromUsdc(remaining.headroomToAutoBorrow)} USDC`);

await floe.setSpendLimit({ limit: toUsdc("5") }); // cap session at 5 USDC
```

## What's in the box

### USDC value type

USDC has 6 decimals. Floats lose precision past ~9 USDC; bigint is the only correct choice.

```ts
import { toUsdc, fromUsdc, formatUsdc, parseRaw, toRaw, USDC_UNIT } from "@floe-agents/core";

toUsdc("1.5")          // 1_500_000n
toUsdc(1.5)            // 1_500_000n
fromUsdc(1_500_000n)   // "1.5"
formatUsdc(1_500_000n) // "1.5 USDC"
parseRaw("1500000")    // 1_500_000n   (wire-format helper)
toRaw(1_500_000n)      // "1500000"    (wire-format helper)
USDC_UNIT              // 1_000_000n   (1 USDC in raw units)
```

`toUsdc` truncates beyond 6 decimals (floor toward zero), throws on garbage input.

### `FloeClient`

`createFloeClient(opts)` returns a typed client mirroring [Floe's live `credit-api`](https://floe-labs.gitbook.io/docs/developers/credit-api). All amounts on the wire are decimal strings; the client converts at the boundary so your code only sees `bigint`.

#### Methods (organized by use case)

**Agent awareness — primary hot path**

| Method | Endpoint |
|---|---|
| `getCreditRemaining()` | `GET /v1/agents/credit-remaining` |
| `getLoanState()` | `GET /v1/agents/loan-state` |
| `getSpendLimit()` | `GET /v1/agents/spend-limit` |
| `setSpendLimit({ limit })` | `PUT /v1/agents/spend-limit` |
| `clearSpendLimit()` | `DELETE /v1/agents/spend-limit` |

**x402 + facilitator-proxied paid HTTP**

| Method | Endpoint |
|---|---|
| `estimateX402Cost({ url, method? })` | `POST /v1/x402/estimate` |
| `proxyCheck(url)` | `GET /v1/proxy/check` |
| `proxyFetch({ url, method?, headers?, body? })` | `POST /v1/proxy/fetch` |

The `estimateX402Cost` response carries a `reflection` block with `willExceedAvailable` / `willExceedHeadroom` / `willExceedSpendLimit` flags — exactly what the bindings use to make affordability decisions before a paid call goes out.

**Credit thresholds (webhook triggers)**

| Method | Endpoint |
|---|---|
| `listCreditThresholds()` | `GET /v1/agents/credit-thresholds` |
| `registerCreditThreshold({ thresholdBps, webhookId })` | `POST /v1/agents/credit-thresholds` |
| `deleteCreditThreshold(id)` | `DELETE /v1/agents/credit-thresholds/:id` |

**Agent lifecycle (registration / balance / close)**

| Method | Endpoint |
|---|---|
| `preRegisterAgent({ collateralToken, borrowLimit, maxRateBps })` | `POST /v1/agents/pre-register` |
| `registerAgent({ delegationTxHash })` | `POST /v1/agents/register` |
| `getAgentBalance()` | `GET /v1/agents/balance` |
| `getAgentTransactions(query?)` | `GET /v1/agents/transactions` |
| `closeAgent()` | `POST /v1/agents/close` |

**Protocol-level credit operations** (returns unsigned transactions; for non-agent users)

| Method | Endpoint |
|---|---|
| `instantBorrow(params)` | `POST /v1/credit/instant-borrow` |
| `repayLoan({ loanId, slippageBps })` | `POST /v1/credit/repay` |
| `repayAndReborrow(params & { loanId })` | `POST /v1/credit/repay-and-reborrow` |
| `getLoanStatus(loanId)` | `GET /v1/credit/status/:loanId` |
| `getPositions(wallet, query?)` | `GET /v1/positions/:wallet` |
| `getBorrowAttempt(attemptId)` | `GET /v1/credit/borrow-attempts/:id` |
| `resumeBorrowAttempt(attemptId)` | `POST /v1/credit/borrow-attempts/:id/resume` |
| `abandonBorrowAttempt(attemptId)` | `POST /v1/credit/borrow-attempts/:id/abandon` |
| `broadcastTx({ signedTransactionHex, attemptId?, phase? })` | `POST /v1/tx/broadcast` |

**Public (no auth)**

| Method | Endpoint |
|---|---|
| `getMarkets()` | `GET /v1/markets` |
| `getCreditOffers(query?)` | `GET /v1/credit/offers` |
| `getCostOfCapital(marketId, query)` | `GET /v1/markets/:marketId/cost-of-capital` |
| `getHealth()` | `GET /v1/health` |

### `FloeClientError`

Thrown for non-2xx responses. Carries `status`, `path`, `method`, `body` — useful for retries, logging, error pages.

```ts
import { FloeClientError } from "@floe-agents/core";

try {
  await floe.getCreditRemaining();
} catch (err) {
  if (err instanceof FloeClientError && err.status === 401) {
    // bad / missing API key
  }
}
```

### Auth modes

The client supports both auth modes Floe accepts:

```ts
// API key (primary mode for agents)
createFloeClient({ apiKey: "floe_live_..." });

// Wallet signature (EIP-191) — for developer-mode endpoints
createFloeClient({
  walletAddress: "0x...",
  walletSigner: async ({ address, timestamp }) => {
    // sign `Floe Auth ${address}:${timestamp}` with your key
    return signature;
  },
});

// Both — wallet headers used when explicitly preferred
createFloeClient({
  apiKey: "floe_live_...",
  walletAddress: "0x...",
  walletSigner: async () => "...",
});
```

Public endpoints (`getMarkets`, `getCreditOffers`, `getCostOfCapital`, `getHealth`, `proxyCheck`) work without any auth.

## Mock vs Real

This package has **no built-in mock server** — it's just a typed client. The mock servers live in the example dirs of the framework binding packages. To test the client against a mock, point `baseUrl` at the mock URL:

```ts
const floe = createFloeClient({
  apiKey: "mock-key",
  baseUrl: "http://localhost:4040",
});
```

To test against **production Floe**:

1. Visit [dev-dashboard.floelabs.xyz](https://dev-dashboard.floelabs.xyz), connect wallet, create an API key (`floe_live_...`).
2. Set `FLOE_API_KEY` in your environment.
3. Use the default `baseUrl` (`https://credit-api.floelabs.xyz`).

```ts
const floe = createFloeClient({
  apiKey: process.env.FLOE_API_KEY,
  // baseUrl defaults to https://credit-api.floelabs.xyz
});
```

## Tests

```bash
pnpm test         # mocked tests (no network, no keys)
pnpm test:real    # real-key smoke test against live API
                  #   requires FLOE_API_KEY + FLOE_REAL_E2E=1
pnpm typecheck
pnpm build
```

The mocked test suite runs 60 tests covering all endpoint shapes and auth modes against an in-memory `fetch` shim.

The real-key test runs read-only smoke checks against the live API. It never moves capital and never mutates server-side state — fine to run against a real `floe_live_...` key.

## Design notes

- **Bigint, not number**, for all USDC amounts. Conversion helpers handle ergonomics at the user boundary.
- **No agent-framework dependencies.** The bindings depend on this package, not vice versa.
- **No `debit()` method.** Floe has no `POST /v1/credit/debit` endpoint and shouldn't — money moves only via borrow / x402-settle / repay. If you need to track spending, diff `getCreditRemaining()` snapshots before and after the work that consumed credit.
- **Spend limit enforcement is server-side**, so `setSpendLimit` is a one-shot setup call, not a hook that needs to fire on every tool call.
- **Error mapping** is uniform: any non-2xx response becomes a `FloeClientError` with the parsed JSON body attached.

## License

MIT.
