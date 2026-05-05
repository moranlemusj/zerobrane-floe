/**
 * LangGraph + Floe agent demo.
 *
 * A `createReactAgent` ReAct loop with one paid tool: `run_code`. The
 * tool's handler routes through Floe's facilitator (`floe.proxyFetch`)
 * — Floe debits the agent's credit line, pays the x402 endpoint, and
 * returns the result. Mirrors the Claude package's agent demo on the
 * LangGraph side.
 *
 * Run modes:
 *   pnpm example:agent              # mocked Floe + live Anthropic (needs ANTHROPIC_API_KEY)
 *   pnpm example:agent:dry          # mocks only — exercises the tool wiring without Anthropic
 *   pnpm example:agent:real         # FLOE_REAL=1 + FLOE_API_KEY + ANTHROPIC_API_KEY +
 *                                     MOCK_EXEC_URL pointing at a real x402 code-exec endpoint
 *
 * Env:
 *   ANTHROPIC_API_KEY   required for non-dry runs
 *   FLOE_DRY_RUN=1      mock-only mode (no Anthropic call)
 *   FLOE_REAL=1         use live Floe at FLOE_BASE_URL with FLOE_API_KEY + a real exec URL
 *   FLOE_API_KEY        required when FLOE_REAL=1
 *   FLOE_BASE_URL       defaults to https://credit-api.floelabs.xyz
 *   MOCK_EXEC_URL       required when FLOE_REAL=1 (the x402 code-exec URL Floe should proxy to)
 *   ANTHROPIC_MODEL     defaults to claude-haiku-4-5
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { createFloeClient, fromUsdc, toUsdc } from "@floe-agents/core";
import {
  type MockEndpoints,
  getMockState,
  startMockServers,
} from "../lib/start.js";

const DRY_RUN = process.env.FLOE_DRY_RUN === "1";
const REAL = process.env.FLOE_REAL === "1";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

async function main() {
  let floeBaseUrl: string;
  let execBaseUrl: string;
  let floeApiKey: string;
  let mocks: MockEndpoints | null = null;

  if (REAL) {
    if (!process.env.FLOE_API_KEY || !process.env.MOCK_EXEC_URL) {
      console.error("FLOE_REAL=1 requires FLOE_API_KEY and MOCK_EXEC_URL");
      process.exit(1);
    }
    floeBaseUrl = process.env.FLOE_BASE_URL ?? "https://credit-api.floelabs.xyz";
    execBaseUrl = process.env.MOCK_EXEC_URL;
    floeApiKey = process.env.FLOE_API_KEY;
    console.log(`[demo] mode: REAL — Floe ${floeBaseUrl}, exec ${execBaseUrl}`);
  } else {
    mocks = await startMockServers({ withAgentExec: true });
    floeBaseUrl = mocks.floeBaseUrl;
    execBaseUrl = `${mocks.execBaseUrl}/exec`;
    floeApiKey = "mock-key";
    console.log(`[demo] mode: MOCK — Floe ${floeBaseUrl}, exec ${execBaseUrl}`);
  }

  const floe = createFloeClient({ apiKey: floeApiKey, baseUrl: floeBaseUrl });
  if (!REAL) {
    await floe.setSpendLimit({ limit: toUsdc("1") });
    console.log("[demo] applied spend limit: 1 USDC");
  }

  const initial = await floe.getCreditRemaining();
  console.log(
    `[demo] credit: available=${fromUsdc(initial.available)} headroom=${fromUsdc(initial.headroomToAutoBorrow)} util=${initial.utilizationBps}bps`,
  );

  // The paid tool. Handler is hand-instrumented (before/after credit-remaining
  // diff) so the demo prints per-call spend without needing withFloe inside
  // a tool handler. (For node-level instrumentation, see with-floe-search.)
  const events: string[] = [];
  const runCode = tool(
    async (input: { code: string }) => {
      const before = await floe.getCreditRemaining();
      const proxied = await floe.proxyFetch({
        url: execBaseUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { code: input.code, language: "javascript" },
      });
      const after = await floe.getCreditRemaining();
      const delta = after.sessionSpent - before.sessionSpent;
      events.push(`run_code: status=${proxied.status} Δ=${fromUsdc(delta)} USDC`);
      return JSON.stringify(proxied.body);
    },
    {
      name: "run_code",
      description:
        "Execute JavaScript code on a paid x402 sandbox. Costs ~0.05 USDC per call (settled via Floe's facilitator). Use `return` to return a value.",
      schema: z.object({
        code: z.string().describe("JavaScript code to execute"),
      }),
    },
  );

  if (DRY_RUN) {
    console.log("[demo] FLOE_DRY_RUN=1 — exercising tool against mocks, skipping Anthropic.");
    const result = await runCode.invoke({
      code: "let s = 0; for (let i = 1; i <= 10; i++) s += i; return s;",
    });
    console.log(`[demo] dry tool result: ${result}`);
    console.log(`[demo] events: ${events.join(" | ")}`);

    if (mocks) {
      const state = await getMockState(mocks.floeBaseUrl);
      console.log(
        `[demo] mock-floe ledger: sessionSpent=${state.sessionSpent} creditOut=${state.creditOut}`,
      );
      await floe.clearSpendLimit();
      await mocks.stop();
    }
    console.log("[demo] done.");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY required for the live agent run. Use FLOE_DRY_RUN=1 for the mock-only path.",
    );
    process.exit(1);
  }

  const llm = new ChatAnthropic({
    model: ANTHROPIC_MODEL,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const agent = createReactAgent({
    llm,
    tools: [runCode],
    prompt:
      "You are a helpful assistant with access to a paid sandbox via the `run_code` tool. " +
      "Each call costs ~0.05 USDC, settled via Floe — use the tool when it's the cheapest reliable way " +
      "to compute the answer; use it sparingly. Show your work briefly.",
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "Use run_code to compute the sum of squares from 1 to 50 (i.e. 1*1 + 2*2 + ... + 50*50). Return the answer.",
      },
    ],
  });

  // Print only the final assistant message + the tool spend events.
  const last = result.messages[result.messages.length - 1];
  const text =
    last && typeof last === "object" && "content" in last
      ? typeof (last as { content: unknown }).content === "string"
        ? ((last as { content: string }).content)
        : JSON.stringify((last as { content: unknown }).content)
      : "(no response)";
  console.log(`[claude] ${text}`);
  console.log(`[demo] tool events: ${events.length === 0 ? "(none)" : events.join(" | ")}`);

  if (mocks) {
    const state = await getMockState(mocks.floeBaseUrl);
    console.log(
      `[demo] mock-floe ledger: sessionSpent=${state.sessionSpent} creditOut=${state.creditOut} util=${state.utilizationBps}bps`,
    );
    await floe.clearSpendLimit();
    await mocks.stop();
  }
  console.log("[demo] done.");
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
