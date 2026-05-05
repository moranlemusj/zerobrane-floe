/**
 * Mocked e2e tests for both example demos.
 *
 * Boots mock-floe + the upstream paid endpoints on ephemeral ports,
 * runs the actual demo wiring, and verifies the mock-floe ledger
 * reflects the expected debit. Neither test invokes Anthropic.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
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
  mocks = await startMockServers({ withAgentExec: true });
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

describe("agent example wiring (no Anthropic call)", () => {
  it("the run_code tool routes through floe.proxyFetch and debits via mock-floe", async () => {
    await fetch(`${mocks.floeBaseUrl}/__mock/reset`, { method: "POST" });
    expect(mocks.execBaseUrl).toBeDefined();

    const events: { delta: bigint; status: number }[] = [];
    const runCode = tool(
      async (input: { code: string }) => {
        const before = await floe.getCreditRemaining();
        const proxied = await floe.proxyFetch({
          url: `${mocks.execBaseUrl}/exec`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: { code: input.code, language: "javascript" },
        });
        const after = await floe.getCreditRemaining();
        events.push({
          delta: after.sessionSpent - before.sessionSpent,
          status: proxied.status,
        });
        return JSON.stringify(proxied.body);
      },
      {
        name: "run_code",
        description: "Run JS via Floe.",
        schema: z.object({ code: z.string() }),
      },
    );

    const out = await runCode.invoke({
      code: "let s=0; for(let i=1;i<=10;i++) s+=i*i; return s;",
    });
    const parsed = JSON.parse(out as string) as { ok: boolean; returned: string | null };
    // 1*1 + 2*2 + ... + 10*10 = 385
    expect(parsed.ok).toBe(true);
    expect(parsed.returned).toBe("385");

    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe(200);
    expect(events[0]?.delta).toBe(50_000n);

    const state = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(state.sessionSpent)).toBe(50_000n);
  });
});
