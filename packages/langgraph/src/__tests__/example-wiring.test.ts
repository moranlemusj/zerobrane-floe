/**
 * Mocked e2e test that exercises both demo flows:
 *   - with-floe-search: search node wrapped in withFloe
 *   - code-exec: floeCodeExecNode against mock-x402-exec
 *
 * Boots all three mocks (mock-floe, mock-search, mock-x402-exec) on
 * ephemeral ports, runs each graph, and verifies the mock-floe ledger
 * reflects the expected debit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createFloeClient, type FloeClient } from "@floe-agents/core";
import {
  getMockState,
  type MockEndpoints,
  startMockServers,
} from "../../examples/lib/start.js";
import { floeCodeExecNode } from "../floe-code-exec.js";
import type { CodeExecResult, WithFloeEvent } from "../types.js";
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
  it("withFloe-wrapped search node debits mock-floe and emits credit_consumed", async () => {
    await fetch(`${mocks.floeBaseUrl}/__mock/reset`, { method: "POST" });

    const State = Annotation.Root({
      query: Annotation<string>(),
      results: Annotation<unknown[]>({
        reducer: (_p, n) => n,
        default: () => [],
      }),
    });

    const innerNode = async (state: typeof State.State) => {
      const res = await fetch(`${mocks.searchBaseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: state.query }),
      });
      const body = (await res.json()) as { results: unknown[] };
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
      expect(consumed.deltaUsdc).toBe(10_000n);
    }

    const state = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(state.sessionSpent)).toBeGreaterThanOrEqual(10_000n);
  });
});

describe("code-exec example wiring", () => {
  it("floeCodeExecNode runs JS via mock-x402-exec and tracks 0.05 USDC spend", async () => {
    await fetch(`${mocks.floeBaseUrl}/__mock/reset`, { method: "POST" });

    const State = Annotation.Root({
      code: Annotation<string>(),
      execution: Annotation<CodeExecResult | undefined>({
        reducer: (_p, n) => n,
        default: () => undefined,
      }),
    });

    const events: WithFloeEvent[] = [];
    const node = floeCodeExecNode<typeof State.State>({
      endpoint: `${mocks.execBaseUrl}/exec`,
      apiKey: "mock-key",
      floe: { client: floe, onEvent: (e) => events.push(e) },
    });

    const graph = new StateGraph(State)
      .addNode("exec", node)
      .addEdge(START, "exec")
      .addEdge("exec", END)
      .compile();

    const result = await graph.invoke({
      code: "let s = 0; for (let i = 1; i <= 10; i++) s += i; return s;",
    });

    expect(result.execution?.ok).toBe(true);
    expect(result.execution?.returned).toBe("55");
    expect(result.execution?.paidUsdc).toBe("50000");

    const consumed = events.find((e) => e.type === "credit_consumed");
    if (consumed?.type === "credit_consumed") {
      expect(consumed.deltaUsdc).toBe(50_000n);
    }

    const state = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(state.sessionSpent)).toBe(50_000n);
  });

  it("floeCodeExecNode in proxy mode routes through mock-floe /v1/proxy/fetch", async () => {
    await fetch(`${mocks.floeBaseUrl}/__mock/reset`, { method: "POST" });

    const State = Annotation.Root({
      code: Annotation<string>(),
      execution: Annotation<CodeExecResult | undefined>({
        reducer: (_p, n) => n,
        default: () => undefined,
      }),
    });

    const events: WithFloeEvent[] = [];
    const node = floeCodeExecNode<typeof State.State>({
      endpoint: `${mocks.execBaseUrl}/exec`,
      proxy: { useFloeProxy: true },
      floe: { client: floe, onEvent: (e) => events.push(e) },
    });

    const graph = new StateGraph(State)
      .addNode("exec", node)
      .addEdge(START, "exec")
      .addEdge("exec", END)
      .compile();

    const result = await graph.invoke({ code: "return 7 * 6;" });
    expect(result.execution?.returned).toBe("42");

    // Proxy mode debits exactly once (mock-floe's proxy handler), not twice.
    // Upstream sees X-Floe-Settled: true and skips its own debit.
    const state = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(state.sessionSpent)).toBe(50_000n);
  });
});
