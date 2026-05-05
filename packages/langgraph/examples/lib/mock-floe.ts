/**
 * mock-floe — in-memory Express server that mirrors the live Floe `credit-api`
 * surface. Identical contract to the claude package's mock; duplicated here so
 * each package's examples are self-contained.
 *
 * Internal-only `/__mock/*` namespace simulates facilitator settlement.
 * The published FloeClient never calls /__mock/*.
 */

import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

const PORT = Number(process.env.MOCK_FLOE_PORT ?? 4040);
const CREDIT_LIMIT_RAW = BigInt(process.env.MOCK_FLOE_CREDIT_LIMIT ?? "10000000");

interface State {
  creditLimit: bigint;
  creditOut: bigint;
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
const available = () => 0n;
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
  res.json({
    active: true,
    limitRaw: state.sessionSpendLimit.toString(),
    sessionSpentRaw: state.sessionSpent.toString(),
    sessionRemainingRaw: (state.sessionSpendLimit - state.sessionSpent).toString(),
  });
});

app.delete("/v1/agents/spend-limit", (_req, res) => {
  state.sessionSpendLimit = null;
  res.status(204).send();
});

app.post("/v1/x402/estimate", (req, res) => {
  const { url, method = "GET" } = req.body as { url: string; method?: string };
  // /search → 0.01 USDC, /exec → 0.05 USDC, anything else → 0.01.
  const price = url.endsWith("/exec") ? 50_000n : 10_000n;
  const sessionRemaining =
    state.sessionSpendLimit !== null ? state.sessionSpendLimit - state.sessionSpent : null;
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
      willExceedAvailable: price > available(),
      willExceedHeadroom: price > headroom(),
      willExceedSpendLimit: sessionRemaining !== null && price > sessionRemaining,
    },
  });
});

app.post("/v1/proxy/fetch", async (req, res) => {
  const { url, method = "GET", headers = {}, body } = req.body as {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  // Settle 0.01 USDC for /search, 0.05 USDC for /exec, by debiting our own ledger.
  const price = url.endsWith("/exec") ? 50_000n : 10_000n;
  if (price > headroom()) {
    return res
      .status(402)
      .json({ x402: true, error: "insufficient_credit", priceRaw: price.toString() });
  }
  if (
    state.sessionSpendLimit !== null &&
    state.sessionSpent + price > state.sessionSpendLimit
  ) {
    return res
      .status(402)
      .json({ x402: true, error: "spend_limit_exceeded", priceRaw: price.toString() });
  }
  state.creditOut += price;
  state.sessionSpent += price;
  console.log(
    `[mock-floe] proxy_fetch ${method} ${url} (price ${price}) — sessionSpent=${state.sessionSpent}`,
  );
  // Forward the call to the upstream. Settlement happened above; the
  // upstream sees a fully-paid request, just like a real x402 endpoint
  // does after Floe's facilitator pays it.
  const upstreamRes = await fetch(url, {
    method,
    headers: { ...headers },
    body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const upstreamBody = await upstreamRes.json().catch(() => ({}));
  res.json({ status: upstreamRes.status, headers: {}, body: upstreamBody });
});

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
  res.json({ ok: true });
});

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = app.listen(PORT, () => {
    console.log(`[mock-floe] listening on http://localhost:${PORT}`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockFloeApp, state as mockFloeState };
