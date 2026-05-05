/**
 * Mocked e2e test for the with-floe-search example.
 *
 * Boots mock-floe + mock-search on ephemeral ports, runs a StateGraph
 * with a withFloe-wrapped node that uses client.proxyFetch, and verifies
 * the mock-floe ledger reflects the expected debit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createFloeClient, type FloeClient } from "@floe-agents/core";
import {
  getMockState,
  type MockEndpoints,
  startMockServers,
} from "../../examples/lib/start.js";
import type { WithFloeEvent } from "../types.js";
import { withFloe } from "../with-floe.js";

let mocks: MockEndpoints;
let floe: FloeClient;

beforeAll(async () => {
  mocks = await startMockServers();
  floe = createFloeClient({ apiKey: "mock-key", baseUrl: mocks.floeBaseUrl });
}, 10_000);

afterAll(async () => {
  await mocks?.stop();
});

describe("with-floe-search example wiring", () => {
  it("withFloe-wrapped node using proxyFetch debits mock-floe and emits credit_consumed", async () => {
    await fetch(`${mocks.floeBaseUrl}/__mock/reset`, { method: "POST" });

    const State = Annotation.Root({
      query: Annotation<string>(),
      results: Annotation<unknown[]>({
        reducer: (_p, n) => n,
        default: () => [],
      }),
    });

    const innerNode = async (state: typeof State.State) => {
      const proxied = await floe.proxyFetch({
        url: `${mocks.searchBaseUrl}/search`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { query: state.query },
      });
      const body = proxied.body as { results: unknown[] };
      return { results: body.results };
    };

    const events: WithFloeEvent[] = [];
    const wrapped = withFloe(innerNode, {
      client: floe,
      preflight: { estimate: () => ({ url: `${mocks.searchBaseUrl}/search`, method: "POST" }) },
      onEvent: (e) => events.push(e),
    });

    const graph = new StateGraph(State)
      .addNode("search", wrapped)
      .addEdge(START, "search")
      .addEdge("search", END)
      .compile();

    const result = await graph.invoke({ query: "hello floe" });
    expect(result.results.length).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    expect(types).toContain("preflight_ok");
    expect(types).toContain("node_completed");
    const consumed = events.find((e) => e.type === "credit_consumed");
    expect(consumed).toBeDefined();
    if (consumed?.type === "credit_consumed") {
      // mock-floe's /v1/proxy/fetch debits 0.01 USDC for /search
      expect(consumed.deltaUsdc).toBe(10_000n);
    }

    const state = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(state.sessionSpent)).toBe(10_000n);
  });
});
