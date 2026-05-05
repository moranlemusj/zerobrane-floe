/**
 * mock-search — local x402-style paid search endpoint.
 *
 * POST /search { query } → { results } after debiting mock-floe 0.01 USDC.
 * 402 with x402-shaped headers if the debit fails.
 */

import { fileURLToPath } from "node:url";
import express, { type Express } from "express";

const PORT = Number(process.env.MOCK_SEARCH_PORT ?? 4042);
const PRICE_RAW = process.env.MOCK_SEARCH_PRICE_RAW ?? "10000";

function getFloeUrl(): string {
  return process.env.MOCK_FLOE_URL ?? "http://localhost:4040";
}

const app: Express = express();
app.use(express.json({ limit: "100kb" }));

app.post("/search", async (req, res) => {
  const { query } = (req.body ?? {}) as { query?: string };
  if (typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "query (string) required" });
  }
  const alreadySettled = req.header("x-floe-settled") === "true";
  if (!alreadySettled) {
    const settle = await fetch(`${getFloeUrl()}/__mock/debit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountRaw: PRICE_RAW, reason: "mock-search" }),
    });
    if (!settle.ok) {
      const body = (await settle.json().catch(() => ({}))) as { error?: string };
      return res.status(402).json({
        x402: true,
        error: body.error ?? "payment_required",
        priceRaw: PRICE_RAW,
        asset: "0xMockUSDC",
        network: "base",
        payTo: "0xMockPayTo",
        scheme: "exact",
      });
    }
  }
  const results = [
    {
      title: `Floe is great — about ${query}`,
      url: "https://floe-labs.gitbook.io/docs",
      snippet: `Hand-fabricated result about ${query}. Cost: ${PRICE_RAW} raw USDC.`,
    },
    {
      title: `Another result about ${query}`,
      url: "https://example.com/x",
      snippet: "Lorem ipsum for the demo.",
    },
  ];
  res.json({ query, results, paid_usdc: PRICE_RAW });
});

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = app.listen(PORT, () => {
    console.log(`[mock-search] listening on http://localhost:${PORT}`);
    console.log(`[mock-search] settling debits to ${getFloeUrl()}`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockSearchApp };
