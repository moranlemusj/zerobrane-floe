/**
 * Mocked e2e test for the code-execution example.
 *
 * Boots mock-floe + mock-exec in-process. Wires up a FloeClient pointed
 * at mock-floe, the credit-preflight hook with a URL extractor, and the
 * borrow-event-logger hook. Simulates a tool call by directly POSTing to
 * mock-exec (which settles via mock-floe's __mock/debit).
 *
 * This validates the full Floe wiring without invoking the Claude Agent
 * SDK or the Anthropic API. The agent demo (`examples/code-execution/run.ts`)
 * exercises the same wiring with the real SDK + ANTHROPIC_API_KEY.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFloeClient, type FloeClient } from "@floe-agents/core";
import {
  extractRunCodeUrl,
  getMockState,
  startMockServers,
  type MockEndpoints,
} from "../../examples/code-execution/lib.js";
import { floeBorrowEventLogger } from "../hooks/borrow-event-logger.js";
import {
  floeCreditPreflight,
  type PreflightOutcome,
} from "../hooks/credit-preflight.js";

let mocks: MockEndpoints;
let client: FloeClient;

beforeAll(async () => {
  mocks = await startMockServers();
  client = createFloeClient({ apiKey: "mock-key", baseUrl: mocks.floeBaseUrl });
}, 10_000);

afterAll(async () => {
  await mocks?.stop();
});

describe("example wiring (mock-floe + mock-exec)", () => {
  it("FloeClient.getCreditRemaining works against mock-floe at startup", async () => {
    const r = await client.getCreditRemaining();
    expect(r.creditLimit).toBe(10_000_000n);
    expect(r.headroomToAutoBorrow).toBe(10_000_000n);
    expect(r.utilizationBps).toBe(0);
  });

  it("setSpendLimit + clearSpendLimit round-trip through mock-floe", async () => {
    const after = await client.setSpendLimit({ limit: 5_000_000n });
    expect(after.active).toBe(true);
    expect(after.limit).toBe(5_000_000n);
    expect(after.sessionRemaining).toBe(5_000_000n);

    const fetched = await client.getSpendLimit();
    expect(fetched?.limit).toBe(5_000_000n);

    await client.clearSpendLimit();
    expect(await client.getSpendLimit()).toBeNull();
  });

  it("estimateX402Cost reflects affordability against mock-floe state", async () => {
    const r = await client.estimateX402Cost({ url: `${mocks.execBaseUrl}/exec`, method: "POST" });
    expect(r.price).toBe(50_000n);
    expect(r.reflection.willExceedHeadroom).toBe(false);
  });

  it("preflight hook fires 'ok' for affordable URL via extractor", async () => {
    const outcomes: PreflightOutcome[] = [];
    const matcher = floeCreditPreflight({
      client,
      onPreflight: (o) => outcomes.push(o),
      estimateUrlFromInput: extractRunCodeUrl(mocks.execBaseUrl),
    });
    await matcher.hooks[0]?.(
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        transcript_path: "/tmp/t",
        cwd: "/tmp",
        tool_name: "mcp__codeexec__run_code",
        tool_input: { code: "console.log(1+1)" },
        tool_use_id: "tu-1",
      },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("ok");
  });

  it("client.proxyFetch routes to mock-exec via mock-floe (single settlement point)", async () => {
    const before = await getMockState(mocks.floeBaseUrl);
    const beforeSpent = BigInt(before.sessionSpent);

    const proxied = await client.proxyFetch({
      url: `${mocks.execBaseUrl}/exec`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { code: "return 1 + 2;" },
    });
    expect(proxied.status).toBe(200);
    const result = proxied.body as { ok: boolean; returned: string | null };
    expect(result.ok).toBe(true);
    expect(result.returned).toBe("3");

    // Settlement happens once, at mock-floe's /v1/proxy/fetch handler.
    const after = await getMockState(mocks.floeBaseUrl);
    expect(BigInt(after.sessionSpent)).toBe(beforeSpent + 50_000n);
    expect(BigInt(after.creditOut)).toBeGreaterThanOrEqual(50_000n);
  });

  it("preflight hook fires 'spend_limit_blocked' when over the cap", async () => {
    await client.setSpendLimit({ limit: 1n }); // 1 raw USDC unit cap
    const outcomes: PreflightOutcome[] = [];
    const matcher = floeCreditPreflight({
      client,
      onPreflight: (o) => outcomes.push(o),
      estimateUrlFromInput: extractRunCodeUrl(mocks.execBaseUrl),
    });
    await matcher.hooks[0]?.(
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        transcript_path: "/tmp/t",
        cwd: "/tmp",
        tool_name: "mcp__codeexec__run_code",
        tool_input: { code: "return 0;" },
        tool_use_id: "tu-2",
      },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(outcomes[0]?.kind).toBe("spend_limit_blocked");
    await client.clearSpendLimit();
  });

  it("borrow-event-logger fires for capital-moving tool", async () => {
    const events: unknown[] = [];
    const m = floeBorrowEventLogger({ onEvent: (e) => events.push(e) });
    await m.hooks[0]?.(
      {
        hook_event_name: "PostToolUse",
        session_id: "s",
        transcript_path: "/tmp/t",
        cwd: "/tmp",
        tool_name: "mcp__floe__repay_loan",
        tool_input: {},
        tool_response: { transactions: [{ to: "0x", data: "0x", value: "0x0", chainId: 8453 }] },
        tool_use_id: "tu-3",
      },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "repay" });
  });
});
