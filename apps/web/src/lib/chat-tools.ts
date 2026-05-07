/**
 * Chatbot tool definitions. Server-only.
 *
 * Two flavors:
 *  - read-only DB tools (cheap, idempotent, no Floe credit consumed)
 *  - "loan teller" — constructs the exact curl that would create a
 *    real borrow via Floe's REST, but never sends it. The bot tells
 *    the user "I won't fire this; copy + run yourself if you mean it."
 */

import { tool } from "ai";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { events, loans } from "@floe-dashboard/data";
import {
  getKpis,
  getDb,
  listLoans,
  listMarkets,
  listOracles,
  loansByMarket,
} from "./queries";
import { getLoan, getLoanEvents } from "./queries-loan";

const FLOE_BASE_URL = "https://credit-api.floelabs.xyz";

const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  WETH: 18,
  cbBTC: 8,
};

// JSON-safe replacer for BigInts in DB rows.
function jsonable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export const chatTools = {
  get_protocol_aggregates: tool({
    description:
      "Get protocol-wide stats: counts of active/repaid/liquidated/at-risk loans, total USDC outstanding, market count, last indexed block.",
    inputSchema: z.object({}),
    async execute() {
      return jsonable(await getKpis());
    },
  }),

  list_markets: tool({
    description:
      "List every lending market on Floe (USDC/WETH, USDC/cbBTC, USDT/cbBTC) with active loan counts and outstanding principal per market.",
    inputSchema: z.object({}),
    async execute() {
      const [markets, byMarket] = await Promise.all([listMarkets(), loansByMarket()]);
      return jsonable({ markets, byMarket });
    },
  }),

  query_loans: tool({
    description:
      "Filter and rank loans. Use this for questions like 'show me at-risk loans', 'biggest borrows', 'loans by borrower 0xabc'.",
    inputSchema: z.object({
      status: z
        .enum([
          "healthy",
          "warning",
          "at_risk",
          "liquidatable",
          "repaid",
          "liquidated",
          "expired",
          "pending",
        ])
        .optional()
        .describe("Filter by displayed Status pill."),
      borrower: z.string().optional().describe("0x address (case-insensitive substring match)."),
      collateralToken: z
        .string()
        .optional()
        .describe("0x address of the collateral token (lowercase)."),
      sort: z
        .enum([
          "currentLtv",
          "principal",
          "matchedAt",
          "closedAt",
          "heldDuration",
          "interestPaid",
          "interestRate",
        ])
        .optional()
        .default("matchedAt"),
      direction: z.enum(["asc", "desc"]).optional().default("desc"),
      limit: z.number().int().min(1).max(50).optional().default(10),
    }),
    async execute({ status, borrower, collateralToken, sort, direction, limit }) {
      const result = await listLoans({
        filter: { status, borrower, collateralToken },
        sort,
        direction,
        limit,
      });
      return jsonable(result);
    },
  }),

  get_loan: tool({
    description:
      "Get full detail + event timeline for a single loan by ID. Use when the user references a specific loan number (e.g. 'tell me about loan 34').",
    inputSchema: z.object({
      loanId: z.string().describe("Numeric loan ID, no '#' prefix."),
    }),
    async execute({ loanId }) {
      const loan = await getLoan(loanId);
      if (!loan) return { error: `loan #${loanId} not found in indexer` };
      const ev = await getLoanEvents(loanId);
      return jsonable({ loan, events: ev });
    },
  }),

  get_oracle_prices: tool({
    description: "Latest Chainlink oracle prices snapshotted by the indexer.",
    inputSchema: z.object({}),
    async execute() {
      return jsonable(await listOracles());
    },
  }),

  get_recent_activity: tool({
    description:
      "Most recent N matcher events across all loans (matched, collateral added/withdrawn, etc.).",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional().default(10),
    }),
    async execute({ limit }) {
      const db = getDb();
      const rows = await db
        .select({
          loanId: events.loanId,
          eventName: events.eventName,
          blockNumber: events.blockNumber,
          blockTimestamp: events.blockTimestamp,
          txHash: events.txHash,
        })
        .from(events)
        .where(sql`${events.loanId} IS NOT NULL`)
        .orderBy(desc(events.blockNumber))
        .limit(limit);
      return jsonable({ events: rows });
    },
  }),

  get_market_offers: tool({
    description:
      "Live lend-side offers in a Floe market. Hits Floe's public REST. Use to answer 'what's available to borrow right now'.",
    inputSchema: z.object({
      marketId: z.string().describe("0x32-byte market ID (from list_markets)."),
    }),
    async execute({ marketId }) {
      const url = `${FLOE_BASE_URL}/v1/credit/offers?marketId=${marketId}`;
      try {
        const r = await fetch(url);
        if (!r.ok) return { error: `Floe REST ${r.status}` };
        return await r.json();
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  }),

  draft_borrow: tool({
    description:
      "PREVIEW ONLY — construct the exact curl command a user would run to borrow on Floe. Does NOT execute. Provide EITHER a literal collateralAmount, OR a targetLtvPct (the tool will compute the required collateral using current oracle prices).",
    inputSchema: z.object({
      market: z
        .string()
        .describe("Either a 0x marketId or a friendly pair like 'USDC/WETH'."),
      borrowAmount: z
        .string()
        .describe("Amount to borrow in human form (e.g. '100 USDC' or '0.5 WETH')."),
      collateralAmount: z
        .string()
        .optional()
        .describe(
          "Collateral to post in human form (e.g. '0.05 WETH'). Omit if using targetLtvPct.",
        ),
      targetLtvPct: z
        .number()
        .min(1)
        .max(95)
        .optional()
        .describe(
          "Desired LTV percentage (1-95). When set, the tool reads the oracle and computes the collateral amount needed to hit this LTV. Use this when the user specifies an LTV (e.g. '50% LTV') instead of a collateral amount.",
        ),
      maxRateBps: z
        .number()
        .int()
        .min(0)
        .max(10000)
        .optional()
        .default(1500)
        .describe("Max interest rate in bps. 1500 = 15% APR. Default 1500."),
      durationDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(30)
        .describe("Loan term in days. Default 30."),
    }),
    async execute({
      market,
      borrowAmount,
      collateralAmount,
      targetLtvPct,
      maxRateBps,
      durationDays,
    }) {
      if (!collateralAmount && targetLtvPct === undefined) {
        return {
          ok: false,
          error: "Provide either collateralAmount or targetLtvPct.",
        };
      }
      // Resolve market to a real on-chain marketId.
      const allMarkets = await listMarkets();
      let resolved = allMarkets.find((m) => m.marketId === market);
      if (!resolved) {
        // Try friendly pair lookup
        const [loanSym, colSym] = market.toUpperCase().split("/");
        resolved = allMarkets.find(
          (m) => m.loanTokenSymbol.toUpperCase() === loanSym && m.collateralTokenSymbol.toUpperCase() === colSym,
        );
      }
      if (!resolved) {
        return {
          ok: false,
          error: `Market not found. Known markets: ${allMarkets.map((m) => `${m.loanTokenSymbol}/${m.collateralTokenSymbol}`).join(", ")}`,
        };
      }

      const borrowParsed = parseHumanAmount(borrowAmount);
      if (!borrowParsed) {
        return {
          ok: false,
          error:
            "Could not parse borrowAmount. Use form '<number> <symbol>' (e.g. '100 USDC').",
        };
      }
      if (borrowParsed.symbol !== resolved.loanTokenSymbol) {
        return {
          ok: false,
          error: `borrowAmount must be ${resolved.loanTokenSymbol} for this market, got ${borrowParsed.symbol}.`,
        };
      }

      // Look up oracle for the collateral token (needed for target-LTV
      // mode and for the "implied LTV" warning either way).
      const oracles = await listOracles();
      const oracleDescByCol: Record<string, string> = {
        WETH: "ETH / USD",
        cbBTC: "BTC / USD",
      };
      const oracleDesc = oracleDescByCol[resolved.collateralTokenSymbol];
      const oracle = oracleDesc ? oracles.find((o) => o.description === oracleDesc) : undefined;
      const colPrice = oracle
        ? Number(oracle.latestAnswer) / 10 ** oracle.decimals
        : null;

      // Resolve collateral amount: literal input OR derived from target LTV.
      let colHumanValue: number;
      let collateralSource: "literal" | "derived";
      if (collateralAmount) {
        const colParsed = parseHumanAmount(collateralAmount);
        if (!colParsed) {
          return {
            ok: false,
            error:
              "Could not parse collateralAmount. Use form '<number> <symbol>' (e.g. '0.05 WETH').",
          };
        }
        if (colParsed.symbol !== resolved.collateralTokenSymbol) {
          return {
            ok: false,
            error: `collateralAmount must be ${resolved.collateralTokenSymbol} for this market, got ${colParsed.symbol}.`,
          };
        }
        colHumanValue = colParsed.value;
        collateralSource = "literal";
      } else {
        if (colPrice === null) {
          return {
            ok: false,
            error: `Cannot derive collateral from targetLtvPct: no oracle price available for ${resolved.collateralTokenSymbol}. Provide a literal collateralAmount instead.`,
          };
        }
        // borrow_usd / colPrice / (target_ltv/100) = colAmount
        const debtUsd = borrowParsed.value; // USDC/USDT ≈ $1
        const ltvFraction = (targetLtvPct ?? 50) / 100;
        colHumanValue = debtUsd / colPrice / ltvFraction;
        collateralSource = "derived";
      }

      const borrowRaw = toBaseUnits(borrowParsed.value, resolved.loanTokenDecimals);
      const colRaw = toBaseUnits(colHumanValue, resolved.collateralTokenDecimals);
      const durationSec = durationDays * 86400;

      let impliedLtvPct: number | null = null;
      let warning: string | null = null;
      if (colPrice !== null) {
        const colUsd = colHumanValue * colPrice;
        const debtUsd = borrowParsed.value;
        impliedLtvPct = colUsd > 0 ? (debtUsd / colUsd) * 100 : null;
        if (impliedLtvPct !== null && impliedLtvPct > 80) {
          warning = `Implied LTV ${impliedLtvPct.toFixed(1)}% looks high. Floe markets typically liquidate around 90%. A small price drop could trigger liquidation immediately after origination.`;
        }
      }

      const body = {
        marketId: resolved.marketId,
        borrowAmount: borrowRaw,
        collateralAmount: colRaw,
        maxInterestRateBps: maxRateBps,
        duration: durationSec,
      };
      const curl = [
        `curl -X POST ${FLOE_BASE_URL}/v1/credit/instant-borrow \\`,
        `  -H "Authorization: Bearer floe_live_<YOUR_KEY>" \\`,
        `  -H "Idempotency-Key: $(uuidgen)" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${JSON.stringify(body, null, 2).replace(/\n/g, "\n     ")}'`,
      ].join("\n");

      const collateralLabel = `${colHumanValue.toLocaleString(undefined, {
        maximumFractionDigits: 8,
      })} ${resolved.collateralTokenSymbol}`;
      return {
        ok: true,
        previewOnly: true,
        market: `${resolved.loanTokenSymbol}/${resolved.collateralTokenSymbol}`,
        marketId: resolved.marketId,
        humanIntent: {
          borrow: borrowAmount,
          collateral:
            collateralSource === "derived"
              ? `${collateralLabel} (computed from ${targetLtvPct}% target LTV at ${colPrice ? `$${colPrice.toFixed(2)}/${resolved.collateralTokenSymbol}` : "current price"})`
              : collateralLabel,
          rate: `up to ${(maxRateBps / 100).toFixed(2)}% APR`,
          duration: `${durationDays} days`,
        },
        impliedLtvPct: impliedLtvPct !== null ? Number(impliedLtvPct.toFixed(2)) : null,
        warning,
        curl,
        nextSteps: [
          "1. Run the curl with your real Floe API key. Response gives unsigned transactions.",
          "2. Sign each transaction with your wallet (the API returns the bytes; broadcast via wallet).",
          "3. POST signed bytes to /v1/tx/broadcast with the attemptId from step 1.",
          "4. Poll /v1/credit/borrow-attempts/:attemptId until state='active'. Loan ID is then in the response.",
        ],
        note: "I am NOT executing this. This is a preview Floe killed in their hosted chatbot — here it's read-only by design.",
      };
    },
  }),

  // Sanity check: helps the bot remember its own data freshness boundaries.
  get_indexer_status: tool({
    description:
      "Indexer freshness — last block synced, when reconcile last ran. Use when a user asks 'how fresh is this data' or notices a discrepancy.",
    inputSchema: z.object({}),
    async execute() {
      const db = getDb();
      const r = await db.execute(
        sql`SELECT value AS last_block, updated_at FROM indexer_state WHERE key = 'lastBlock'`,
      );
      const loanCount = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ${loans}`);
      return jsonable({
        lastBlock: r.rows[0],
        loanCount: loanCount.rows[0],
      });
    },
  }),
} as const;

interface ParsedAmount {
  value: number;
  symbol: string;
}
function parseHumanAmount(s: string): ParsedAmount | null {
  const m = s.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const symbol = m[2];
  if (!(symbol in TOKEN_DECIMALS)) {
    // Allow case mismatches — find a known symbol that matches case-insensitively.
    const upper = symbol.toUpperCase();
    const match = Object.keys(TOKEN_DECIMALS).find((k) => k.toUpperCase() === upper);
    if (!match) return null;
    return { value, symbol: match };
  }
  return { value, symbol };
}

function toBaseUnits(human: number, decimals: number): string {
  // Use BigInt to avoid float precision artifacts on large multipliers.
  const [whole, frac = ""] = human.toString().split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

// Avoid unused-import lint when we only use these for table refs.
void eq;
