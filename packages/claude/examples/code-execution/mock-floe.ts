/**
 * mock-floe — in-memory Express server that mirrors the live Floe `credit-api`
 * surface for demos and tests.
 *
 * Mirrors the real shapes (`/v1/agents/credit-remaining`, `PUT /v1/agents/spend-limit`,
 * `POST /v1/x402/estimate`, etc.) so the typed client works against it
 * unchanged. Adds an internal-only `/__mock/*` namespace used by the paid-
 * endpoint mocks (`mock-exec`) to simulate facilitator settlement. The
 * published client never calls `/__mock/*` — the prefix is loud on
 * purpose.
 *
 * Run standalone:
 *   pnpm tsx examples/code-execution/mock-floe.ts
 *
 * Env:
 *   MOCK_FLOE_PORT          (default 4040)
 *   MOCK_FLOE_CREDIT_LIMIT  (default 10000000 = 10 USDC)
 */

import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

const PORT = Number(process.env.MOCK_FLOE_PORT ?? 4040);
const CREDIT_LIMIT_RAW = BigInt(process.env.MOCK_FLOE_CREDIT_LIMIT ?? "10000000");

interface State {
  creditLimit: bigint;
  creditOut: bigint; // sum of facilitator-borrowings (== sum of debits)
  sessionSpent: bigint;
  sessionSpendLimit: bigint | null;
}

const state: State = {
  creditLimit: CREDIT_LIMIT_RAW,
  creditOut: 0n,
  sessionSpent: 0n,
  sessionSpendLimit: null,
};

const PUBLIC_PATHS = new Set<string>(["/v1/health", "/v1/markets"]);

const app: Express = express();
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith("/v1/proxy/check") || req.path.startsWith("/__mock")) {
    return next();
  }
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing api key" });
  }
  next();
});

const headroom = () => state.creditLimit - state.creditOut;
const available = () => 0n; // in this model the facilitator borrows just-in-time
const utilizationBps = () =>
  state.creditLimit === 0n ? 0 : Number((state.creditOut * 10000n) / state.creditLimit);

app.get("/v1/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/v1/markets", (_req, res) => {
  res.json({ markets: [] });
});

app.get("/v1/agents/credit-remaining", (_req, res) => {
  res.json({
    available: available().toString(),
    creditIn: state.creditLimit.toString(),
    creditOut: state.creditOut.toString(),
    creditLimit: state.creditLimit.toString(),
    headroomToAutoBorrow: headroom().toString(),
    utilizationBps: utilizationBps(),
    sessionSpendLimit: state.sessionSpendLimit?.toString() ?? null,
    sessionSpent: state.sessionSpent.toString(),
    sessionSpendRemaining:
      state.sessionSpendLimit !== null
        ? (state.sessionSpendLimit - state.sessionSpent).toString()
        : null,
    asOf: new Date().toISOString(),
  });
});

app.get("/v1/agents/loan-state", (_req, res) => {
  const s =
    state.creditOut === 0n ? "idle" : utilizationBps() >= 9500 ? "at_limit" : "borrowing";
  res.json({
    state: s,
    details: {
      source: "facility",
      available: available().toString(),
      creditLimit: state.creditLimit.toString(),
    },
  });
});

app.get("/v1/agents/spend-limit", (_req, res) => {
  if (state.sessionSpendLimit === null) return res.json(null);
  res.json({
    active: true,
    limitRaw: state.sessionSpendLimit.toString(),
    sessionSpentRaw: state.sessionSpent.toString(),
    sessionRemainingRaw: (state.sessionSpendLimit - state.sessionSpent).toString(),
  });
});

app.put("/v1/agents/spend-limit", (req, res) => {
  const { limitRaw } = req.body as { limitRaw?: string };
  if (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw)) {
    return res.status(400).json({ error: "limitRaw must be a non-negative decimal string" });
  }
  state.sessionSpendLimit = BigInt(limitRaw);
  console.log(`[mock-floe] spend-limit set: ${state.sessionSpendLimit}`);
  res.json({
    active: true,
    limitRaw: state.sessionSpendLimit.toString(),
    sessionSpentRaw: state.sessionSpent.toString(),
    sessionRemainingRaw: (state.sessionSpendLimit - state.sessionSpent).toString(),
  });
});

app.delete("/v1/agents/spend-limit", (_req, res) => {
  state.sessionSpendLimit = null;
  console.log(`[mock-floe] spend-limit cleared`);
  res.status(204).send();
});

app.post("/v1/x402/estimate", (req, res) => {
  const { url, method = "GET" } = req.body as { url: string; method?: string };
  // Hardcoded prices: /exec endpoints cost 0.05 USDC, everything else 0.01.
  const price = url.endsWith("/exec") ? 50_000n : 10_000n;
  const sessionRemaining =
    state.sessionSpendLimit !== null ? state.sessionSpendLimit - state.sessionSpent : null;
  const willExceedAvailable = price > available();
  const willExceedHeadroom = price > headroom();
  const willExceedSpendLimit = sessionRemaining !== null && price > sessionRemaining;
  res.json({
    url,
    method,
    x402: true,
    priceRaw: price.toString(),
    asset: "0xMockUSDC",
    network: "base",
    payTo: "0xMockPayTo",
    scheme: "exact",
    cached: false,
    fetchedAt: new Date().toISOString(),
    reflection: {
      available: available().toString(),
      headroomToAutoBorrow: headroom().toString(),
      sessionSpendRemaining: sessionRemaining?.toString() ?? null,
      willExceedAvailable,
      willExceedHeadroom,
      willExceedSpendLimit,
    },
  });
});

// Internal-only mock-debit endpoint. Used by the paid-endpoint mocks
// (mock-exec.ts / mock-x402-exec.ts) to simulate facilitator settlement.
// The published Floe client never calls this — the `__mock` prefix is loud
// on purpose.
app.post("/__mock/debit", (req, res) => {
  const { amountRaw, reason } = req.body as { amountRaw: string; reason?: string };
  if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) {
    return res.status(400).json({ error: "amountRaw must be a non-negative decimal string" });
  }
  const amount = BigInt(amountRaw);
  if (amount > headroom()) {
    return res.status(402).json({ error: "insufficient_credit" });
  }
  if (
    state.sessionSpendLimit !== null &&
    state.sessionSpent + amount > state.sessionSpendLimit
  ) {
    return res.status(402).json({ error: "spend_limit_exceeded" });
  }
  state.creditOut += amount;
  state.sessionSpent += amount;
  console.log(
    `[mock-floe] debit ${amount} (reason: ${reason ?? "n/a"}) — sessionSpent=${state.sessionSpent}, creditOut=${state.creditOut}`,
  );
  res.json({
    debited: amount.toString(),
    creditOut: state.creditOut.toString(),
    sessionSpent: state.sessionSpent.toString(),
  });
});

app.get("/__mock/state", (_req, res) => {
  res.json({
    creditLimit: state.creditLimit.toString(),
    creditOut: state.creditOut.toString(),
    sessionSpent: state.sessionSpent.toString(),
    sessionSpendLimit: state.sessionSpendLimit?.toString() ?? null,
    available: available().toString(),
    headroomToAutoBorrow: headroom().toString(),
    utilizationBps: utilizationBps(),
  });
});

app.post("/__mock/reset", (_req, res) => {
  state.creditOut = 0n;
  state.sessionSpent = 0n;
  state.sessionSpendLimit = null;
  console.log(`[mock-floe] state reset`);
  res.json({ ok: true });
});

// Only autostart when run directly (not when imported by tests / lib.ts).
const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = app.listen(PORT, () => {
    console.log(`[mock-floe] listening on http://localhost:${PORT}`);
    console.log(`[mock-floe] credit limit: ${state.creditLimit}`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockFloeApp, state as mockFloeState };
