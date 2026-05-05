/**
 * Real-key smoke test against live Floe `credit-api`.
 *
 * Skipped unless `FLOE_API_KEY` is set in the environment. Runs read-only
 * endpoints only — never moves capital, never registers agents, never
 * mutates server-side state. Intended to confirm the typed client matches
 * the live API shape after a deploy.
 *
 * Run:
 *   FLOE_API_KEY=floe_live_... pnpm --filter @floe-agents/core test:real
 */

import { describe, expect, it } from "vitest";
import { createFloeClient } from "../client.js";

const apiKey = process.env.FLOE_API_KEY;
const baseUrl = process.env.FLOE_BASE_URL ?? "https://credit-api.floelabs.xyz";
const runReal = process.env.FLOE_REAL_E2E === "1" && !!apiKey;

describe.skipIf(!runReal)("FloeClient real-key smoke (read-only)", () => {
  const client = createFloeClient({ apiKey, baseUrl });

  it("GET /v1/health returns ok", async () => {
    const result = await client.getHealth();
    expect(result.status).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it("GET /v1/markets returns a markets payload", async () => {
    const result = await client.getMarkets();
    expect(result).toBeDefined();
  });

  it("GET /v1/agents/credit-remaining returns a typed CreditRemaining", async () => {
    const result = await client.getCreditRemaining();
    expect(typeof result.utilizationBps).toBe("number");
    expect(typeof result.available).toBe("bigint");
    expect(typeof result.headroomToAutoBorrow).toBe("bigint");
  });

  it("GET /v1/agents/loan-state returns a typed LoanState", async () => {
    const result = await client.getLoanState();
    expect(["idle", "borrowing", "at_limit", "repaying", "delegation_inactive"]).toContain(
      result.state,
    );
  });

  it("GET /v1/agents/spend-limit returns null or a typed SpendLimit", async () => {
    const result = await client.getSpendLimit();
    if (result !== null) {
      expect(typeof result.active).toBe("boolean");
      expect(typeof result.limit).toBe("bigint");
    }
  });
});

describe.skipIf(runReal)("FloeClient real-key smoke (skipped)", () => {
  it("skipped — set FLOE_API_KEY and FLOE_REAL_E2E=1 to run", () => {
    expect(runReal).toBe(false);
  });
});
