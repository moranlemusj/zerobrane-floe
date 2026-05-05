/**
 * Floe + Claude Agent SDK code-execution demo.
 *
 * Spins up `mock-floe` and `mock-exec` in-process, wires up:
 *   - `floeApplySpendLimit` — caps the session at 5 USDC server-side.
 *   - `floeCreditPreflight` — reads x402/estimate before each tool call.
 *   - `floeBorrowEventLogger` — logs capital-moving Floe MCP tool calls.
 *   - `floeSystemPrompt` — Floe skill content prepended to system prompt.
 *   - A custom `run_code` SDK MCP tool that POSTs to mock-exec.
 *
 * Then asks Claude to compute something via the `run_code` tool.
 *
 * Run modes:
 *
 *   pnpm example:agent              # default: requires ANTHROPIC_API_KEY
 *   pnpm example:agent:dry          # mock-only smoke (no Claude API call)
 *   pnpm example:agent:real         # real Floe + real Claude
 *                                     (FLOE_API_KEY + ANTHROPIC_API_KEY)
 *
 * Env:
 *   ANTHROPIC_API_KEY   required for non-dry runs
 *   FLOE_DRY_RUN=1      mock-only mode
 *   FLOE_REAL=1         use live Floe at FLOE_BASE_URL with FLOE_API_KEY
 *   FLOE_API_KEY        required when FLOE_REAL=1
 *   FLOE_BASE_URL       defaults to https://credit-api.floelabs.xyz
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createFloeClient, fromUsdc, toUsdc } from "@floe-agents/core";
import { floeApplySpendLimit, floeClearSpendLimit } from "../../src/hooks/spend-limit.js";
import {
  floeCreditPreflight,
  type PreflightOutcome,
} from "../../src/hooks/credit-preflight.js";
import { floeBorrowEventLogger } from "../../src/hooks/borrow-event-logger.js";
import { floeSystemPrompt } from "../../src/skill.js";
import { extractRunCodeUrl, getMockState, startMockServers } from "./lib.js";

const DRY_RUN = process.env.FLOE_DRY_RUN === "1";
const REAL = process.env.FLOE_REAL === "1";

async function main() {
  // 1. Decide where Floe lives + which Anthropic key to use.
  let floeBaseUrl: string;
  let execBaseUrl: string;
  let floeApiKey: string;
  let stopMocks: (() => Promise<void>) | null = null;

  if (REAL) {
    if (!process.env.FLOE_API_KEY) {
      console.error("FLOE_REAL=1 requires FLOE_API_KEY (floe_live_...)");
      process.exit(1);
    }
    floeBaseUrl = process.env.FLOE_BASE_URL ?? "https://credit-api.floelabs.xyz";
    floeApiKey = process.env.FLOE_API_KEY;
    if (!process.env.MOCK_EXEC_URL) {
      console.error(
        "FLOE_REAL=1 also requires MOCK_EXEC_URL pointing at an x402 endpoint to call.",
      );
      process.exit(1);
    }
    execBaseUrl = process.env.MOCK_EXEC_URL;
    console.log(`[demo] mode: REAL — Floe ${floeBaseUrl}, exec ${execBaseUrl}`);
  } else {
    const mocks = await startMockServers();
    floeBaseUrl = mocks.floeBaseUrl;
    execBaseUrl = mocks.execBaseUrl;
    floeApiKey = "mock-key";
    stopMocks = mocks.stop;
    console.log(`[demo] mode: MOCK — Floe ${floeBaseUrl}, exec ${execBaseUrl}`);
  }

  // 2. Build the FloeClient + apply a session spend cap.
  const floe = createFloeClient({ apiKey: floeApiKey, baseUrl: floeBaseUrl });

  if (!REAL) {
    const limit = await floeApplySpendLimit({ client: floe, limit: toUsdc("5") });
    console.log(`[demo] applied spend limit: ${fromUsdc(limit.limit)} USDC`);
  }

  const initial = await floe.getCreditRemaining();
  console.log(
    `[demo] credit: available=${fromUsdc(initial.available)} headroom=${fromUsdc(initial.headroomToAutoBorrow)} util=${initial.utilizationBps}bps`,
  );

  if (DRY_RUN) {
    console.log("[demo] FLOE_DRY_RUN=1 — exercising hooks against mocks, skipping Anthropic.");
    await dryRun({ floe, execBaseUrl });
    if (stopMocks) await stopMocks();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY required for the live agent run. (Use FLOE_DRY_RUN=1 for the mock-only path.)",
    );
    process.exit(1);
  }

  // 3. Build a tiny SDK MCP server with one paid tool: run_code.
  const codeexec = createSdkMcpServer({
    name: "codeexec",
    version: "0.1.0",
    tools: [
      tool(
        "run_code",
        "Execute a JavaScript snippet in a sandboxed runtime. Returns stdout, stderr, and the returned value. Costs 0.05 USDC per call (settled via Floe).",
        { code: z.string().describe("JavaScript code to execute. Use `return` to return a value.") },
        async ({ code }) => {
          const res = await fetch(`${execBaseUrl}/exec`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const body = await res.text();
          return {
            content: [{ type: "text" as const, text: body }],
            isError: !res.ok,
          };
        },
      ),
    ],
  });

  // 4. Wire Floe hooks into options.
  const events: Array<{ kind: "preflight" | "borrow"; data: unknown }> = [];

  const result = query({
    prompt:
      "Use the `run_code` tool to compute the sum 1+2+3+...+10. Return the answer to the user. Be concise.",
    options: {
      mcpServers: {
        codeexec,
      },
      systemPrompt: floeSystemPrompt(),
      hooks: {
        PreToolUse: [
          floeCreditPreflight({
            client: floe,
            estimateUrlFromInput: extractRunCodeUrl(execBaseUrl),
            onPreflight: (o: PreflightOutcome) => {
              console.log(`[preflight] ${o.kind}`);
              events.push({ kind: "preflight", data: o });
            },
            onError: (e) => console.warn(`[preflight] error:`, e),
          }),
        ],
        PostToolUse: [
          floeBorrowEventLogger({
            onEvent: (e) => {
              console.log(`[borrow] ${e.type} via ${e.toolName}`);
              events.push({ kind: "borrow", data: e });
            },
          }),
        ],
      },
    },
  });

  for await (const message of result) {
    if (message.type === "assistant" && "message" in message) {
      // Print only assistant text turns, terse.
      const m = message.message as { content?: Array<{ type: string; text?: string }> };
      for (const block of m.content ?? []) {
        if (block.type === "text" && block.text) {
          console.log(`[claude] ${block.text}`);
        }
      }
    } else if (message.type === "result") {
      const r = message as { subtype?: string; total_cost_usd?: number };
      console.log(`[demo] result: ${r.subtype ?? "ok"}, cost=${r.total_cost_usd ?? "n/a"}`);
    }
  }

  // 5. Verify the ledger.
  if (!REAL) {
    const state = await getMockState(floeBaseUrl);
    console.log(
      `[demo] mock-floe ledger: sessionSpent=${state.sessionSpent} creditOut=${state.creditOut} util=${state.utilizationBps}bps`,
    );
  }
  console.log(`[demo] hook events: ${events.length}`);

  if (!REAL) await floeClearSpendLimit(floe);
  if (stopMocks) await stopMocks();
}

async function dryRun({
  floe,
  execBaseUrl,
}: {
  floe: ReturnType<typeof createFloeClient>;
  execBaseUrl: string;
}) {
  const events: PreflightOutcome[] = [];
  const matcher = floeCreditPreflight({
    client: floe,
    estimateUrlFromInput: extractRunCodeUrl(execBaseUrl),
    onPreflight: (o) => events.push(o),
  });
  await matcher.hooks[0]?.(
    {
      hook_event_name: "PreToolUse",
      session_id: "dry",
      transcript_path: "/tmp/dry",
      cwd: "/tmp",
      tool_name: "mcp__codeexec__run_code",
      tool_input: { code: "return 1+1;" },
      tool_use_id: "dry-1",
    },
    undefined,
    { signal: new AbortController().signal },
  );
  console.log(`[demo] dry preflight outcome: ${events[0]?.kind}`);

  // Make a paid call directly (no Anthropic SDK).
  const res = await fetch(`${execBaseUrl}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "let s = 0; for (let i = 1; i <= 10; i++) s += i; return s;" }),
  });
  const result = (await res.json()) as { ok: boolean; returned: string | null; paid_usdc: string };
  console.log(
    `[demo] dry exec result: ok=${result.ok} returned=${result.returned} paid=${result.paid_usdc}`,
  );

  const after = await floe.getCreditRemaining();
  console.log(
    `[demo] credit after: sessionSpent=${fromUsdc(after.sessionSpent)} util=${after.utilizationBps}bps`,
  );
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
