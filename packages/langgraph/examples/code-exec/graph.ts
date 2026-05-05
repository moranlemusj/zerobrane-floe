/**
 * code-exec — LangGraph demo using the batteries-included `floeCodeExecNode`.
 *
 * Single-node graph that reads `state.code` (a JS snippet), POSTs to a
 * mock x402-paid code-exec endpoint, and writes the structured result to
 * `state.execution`. The wrapping `withFloe` middleware (composed into
 * `floeCodeExecNode`) handles preflight + spend tracking.
 *
 * Run modes:
 *   pnpm example:code-exec        # mocks
 *   pnpm example:code-exec:real   # FLOE_REAL=1 + FLOE_API_KEY +
 *                                   MOCK_EXEC_URL pointing at a real x402
 *                                   code-exec endpoint
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createFloeClient, fromUsdc, toUsdc } from "@floe-agents/core";
import type { CodeExecResult } from "../../src/types.js";
import { floeCodeExecNode } from "../../src/floe-code-exec.js";
import { getMockState, startMockServers } from "../lib/start.js";

const REAL = process.env.FLOE_REAL === "1";

const State = Annotation.Root({
  code: Annotation<string>(),
  execution: Annotation<CodeExecResult | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

async function main() {
  let floeBaseUrl: string;
  let execBaseUrl: string;
  let floeApiKey: string;
  let stop: (() => Promise<void>) | null = null;

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
    const mocks = await startMockServers();
    floeBaseUrl = mocks.floeBaseUrl;
    execBaseUrl = mocks.execBaseUrl;
    floeApiKey = "mock-key";
    stop = mocks.stop;
    console.log(`[demo] mode: MOCK — Floe ${floeBaseUrl}, exec ${execBaseUrl}`);
  }

  const floe = createFloeClient({ apiKey: floeApiKey, baseUrl: floeBaseUrl });
  if (!REAL) await floe.setSpendLimit({ limit: toUsdc("1") });

  const node = floeCodeExecNode<typeof State.State>({
    endpoint: `${execBaseUrl}/exec`,
    apiKey: floeApiKey,
    floe: {
      client: floe,
      onEvent: (e) => {
        if (e.type === "credit_consumed") {
          console.log(`[floeCodeExec] credit_consumed Δ=${fromUsdc(e.deltaUsdc)} USDC`);
        } else if (e.type === "preflight_warning") {
          console.log(`[floeCodeExec] preflight_warning reason=${e.reason}`);
        } else {
          console.log(`[floeCodeExec] ${e.type}`);
        }
      },
    },
  });

  const graph = new StateGraph(State)
    .addNode("exec", node)
    .addEdge(START, "exec")
    .addEdge("exec", END)
    .compile();

  const code = "let s = 0; for (let i = 1; i <= 100; i++) s += i; return s;";
  const result = await graph.invoke({ code });
  console.log(`[demo] code result: ${result.execution?.returned}`);
  console.log(`[demo] paid: ${result.execution?.paidUsdc} raw USDC`);

  if (!REAL) {
    const state = await getMockState(floeBaseUrl);
    console.log(
      `[demo] mock-floe ledger: sessionSpent=${state.sessionSpent} creditOut=${state.creditOut}`,
    );
    await floe.clearSpendLimit();
    if (stop) await stop();
  }
  console.log("[demo] done.");
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
