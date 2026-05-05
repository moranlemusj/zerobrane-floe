/**
 * with-floe-search — LangGraph demo wrapping a paid search node with `withFloe`.
 *
 * Shows the middleware in its simplest form: pre-flight credit check
 * (using x402/estimate when an extractor is provided), inner node runs,
 * before/after credit-remaining diff yields a `credit_consumed` event.
 *
 * Run modes:
 *   pnpm example:with-floe-search        # mocks (no API keys)
 *   pnpm example:with-floe-search:real   # FLOE_REAL=1 + FLOE_API_KEY +
 *                                          MOCK_SEARCH_URL pointing at a
 *                                          real x402 search endpoint
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createFloeClient, fromUsdc, toUsdc } from "@floe-agents/core";
import { withFloe } from "../../src/with-floe.js";
import { getMockState, startMockServers } from "../lib/start.js";

const REAL = process.env.FLOE_REAL === "1";

const State = Annotation.Root({
  query: Annotation<string>(),
  results: Annotation<unknown[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

async function main() {
  let floeBaseUrl: string;
  let searchBaseUrl: string;
  let floeApiKey: string;
  let stop: (() => Promise<void>) | null = null;

  if (REAL) {
    if (!process.env.FLOE_API_KEY || !process.env.MOCK_SEARCH_URL) {
      console.error("FLOE_REAL=1 requires FLOE_API_KEY and MOCK_SEARCH_URL");
      process.exit(1);
    }
    floeBaseUrl = process.env.FLOE_BASE_URL ?? "https://credit-api.floelabs.xyz";
    searchBaseUrl = process.env.MOCK_SEARCH_URL;
    floeApiKey = process.env.FLOE_API_KEY;
    console.log(`[demo] mode: REAL — Floe ${floeBaseUrl}, search ${searchBaseUrl}`);
  } else {
    const mocks = await startMockServers();
    floeBaseUrl = mocks.floeBaseUrl;
    searchBaseUrl = mocks.searchBaseUrl;
    floeApiKey = "mock-key";
    stop = mocks.stop;
    console.log(`[demo] mode: MOCK — Floe ${floeBaseUrl}, search ${searchBaseUrl}`);
  }

  const floe = createFloeClient({ apiKey: floeApiKey, baseUrl: floeBaseUrl });
  if (!REAL) await floe.setSpendLimit({ limit: toUsdc("1") });


  // Inner node: routes the paid call through Floe's facilitator. The
  // facilitator borrows USDC against the agent's pre-authorized
  // delegation, settles the x402 payment, and returns the upstream body.
  const searchNode = async (state: typeof State.State): Promise<Partial<typeof State.State>> => {
    const proxied = await floe.proxyFetch({
      url: `${searchBaseUrl}/search`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { query: state.query },
    });
    const body = proxied.body as { results: unknown[] };
    return { results: body.results };
  };

  const wrapped = withFloe(searchNode, {
    client: floe,
    preflight: { estimate: () => ({ url: `${searchBaseUrl}/search`, method: "POST" }) },
    onEvent: (e) => {
      if (e.type === "credit_consumed") {
        console.log(`[withFloe] credit_consumed Δ=${fromUsdc(e.deltaUsdc)} USDC`);
      } else if (e.type === "preflight_warning") {
        console.log(`[withFloe] preflight_warning reason=${e.reason}`);
      } else {
        console.log(`[withFloe] ${e.type}`);
      }
    },
  });

  const graph = new StateGraph(State)
    .addNode("search", wrapped)
    .addEdge(START, "search")
    .addEdge("search", END)
    .compile();

  const result = await graph.invoke({ query: "Floe x402 onchain credit" });
  console.log(`[demo] result.results.length = ${result.results.length}`);
  console.log(`[demo] first result:`, result.results[0]);

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
