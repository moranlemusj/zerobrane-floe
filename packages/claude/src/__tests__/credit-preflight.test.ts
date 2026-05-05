import type {
  CreditRemaining,
  FloeClient,
  X402CostEstimate,
} from "@floe-agents/core";
import { describe, expect, it, vi } from "vitest";
import {
  type PreflightOutcome,
  floeCreditPreflight,
} from "../hooks/credit-preflight.js";
import type { PreToolUseHookInput } from "../hooks/types.js";

function makePreToolUseInput(toolName: string, toolInput: unknown): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu-1",
  };
}

function makeRemaining(overrides: Partial<CreditRemaining> = {}): CreditRemaining {
  return {
    available: 1_000_000n,
    creditIn: 10_000_000n,
    creditOut: 0n,
    creditLimit: 10_000_000n,
    headroomToAutoBorrow: 9_000_000n,
    utilizationBps: 0,
    sessionSpendLimit: null,
    sessionSpent: 0n,
    sessionSpendRemaining: null,
    asOf: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function makeEstimate(
  reflection: Partial<X402CostEstimate["reflection"]> = {},
): X402CostEstimate {
  return {
    url: "https://api.example.com/x",
    method: "GET",
    isX402: true,
    price: 5_000n,
    asset: "0xUSDC",
    network: "base",
    payTo: "0xpay",
    scheme: "exact",
    cached: false,
    fetchedAt: "2026-05-05T00:00:00.000Z",
    reflection: {
      available: 1_000_000n,
      headroomToAutoBorrow: 9_000_000n,
      sessionSpendRemaining: null,
      willExceedAvailable: false,
      willExceedHeadroom: false,
      willExceedSpendLimit: false,
      ...reflection,
    },
  };
}

function makeFakeClient(overrides?: Partial<FloeClient>): FloeClient {
  const base: Partial<FloeClient> = {
    getCreditRemaining: vi.fn(async () => makeRemaining()),
    estimateX402Cost: vi.fn(async () => makeEstimate()),
  };
  return { ...base, ...(overrides ?? {}) } as FloeClient;
}

describe("floeCreditPreflight", () => {
  it("default matcher excludes Floe's own MCP tools", () => {
    const matcher = floeCreditPreflight({ client: makeFakeClient() }).matcher;
    expect(matcher).toBe("^(?!mcp__floe__).+$");
  });

  it("emits 'ok' on healthy credit-remaining (no extractor configured)", async () => {
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client: makeFakeClient(),
      onPreflight,
    });
    const result = await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", { url: "https://api.example.com" }),
      "tu-1",
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({});
    expect(onPreflight).toHaveBeenCalledOnce();
    const outcome = onPreflight.mock.calls[0]?.[0] as PreflightOutcome;
    expect(outcome.kind).toBe("ok");
  });

  it("emits 'low_credit_warning' when utilization >= warnAt", async () => {
    const client = makeFakeClient({
      getCreditRemaining: vi.fn(async () => makeRemaining({ utilizationBps: 8500 })),
    });
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({ client, onPreflight, warnAtUtilizationBps: 8000 });
    await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    expect((onPreflight.mock.calls[0]?.[0] as PreflightOutcome).kind).toBe(
      "low_credit_warning",
    );
  });

  it("uses estimateX402Cost when extractor returns a URL", async () => {
    const estimateX402Cost = vi.fn(async () =>
      makeEstimate({ willExceedAvailable: false, willExceedHeadroom: false }),
    );
    const client = makeFakeClient({ estimateX402Cost });
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client,
      onPreflight,
      estimateUrlFromInput: (_, input) => {
        const i = input as { url?: string };
        return i.url ? { url: i.url } : null;
      },
    });
    await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", { url: "https://api.example.com/data" }),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(estimateX402Cost).toHaveBeenCalledWith({ url: "https://api.example.com/data" });
    expect((onPreflight.mock.calls[0]?.[0] as PreflightOutcome).kind).toBe("ok");
  });

  it("emits 'would_exceed' when both available and headroom flags set", async () => {
    const client = makeFakeClient({
      estimateX402Cost: vi.fn(async () =>
        makeEstimate({ willExceedAvailable: true, willExceedHeadroom: true }),
      ),
    });
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client,
      onPreflight,
      estimateUrlFromInput: () => ({ url: "https://api.example.com/x" }),
    });
    await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    expect((onPreflight.mock.calls[0]?.[0] as PreflightOutcome).kind).toBe("would_exceed");
  });

  it("emits 'spend_limit_blocked' when willExceedSpendLimit is set (overrides others)", async () => {
    const client = makeFakeClient({
      estimateX402Cost: vi.fn(async () =>
        makeEstimate({
          willExceedAvailable: true,
          willExceedHeadroom: true,
          willExceedSpendLimit: true,
        }),
      ),
    });
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client,
      onPreflight,
      estimateUrlFromInput: () => ({ url: "https://api.example.com/x" }),
    });
    await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    expect((onPreflight.mock.calls[0]?.[0] as PreflightOutcome).kind).toBe(
      "spend_limit_blocked",
    );
  });

  it("emits 'skipped' when extractor returns null", async () => {
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client: makeFakeClient(),
      onPreflight,
      estimateUrlFromInput: () => null,
    });
    await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    const outcome = onPreflight.mock.calls[0]?.[0] as PreflightOutcome;
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toBe("no_url_extractor");
    }
  });

  it("never throws — errors go to onError, hook still returns NOOP", async () => {
    const err = new Error("network down");
    const client = makeFakeClient({
      getCreditRemaining: vi.fn(async () => {
        throw err;
      }),
    });
    const onError = vi.fn();
    const matcher = floeCreditPreflight({ client, onError });
    const result = await matcher.hooks[0]?.(
      makePreToolUseInput("WebFetch", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({});
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("returns NOOP without action for non-PreToolUse events", async () => {
    const onPreflight = vi.fn();
    const matcher = floeCreditPreflight({
      client: makeFakeClient(),
      onPreflight,
    });
    const result = await matcher.hooks[0]?.(
      // @ts-expect-error — intentional: not a PreToolUse input
      { hook_event_name: "PostToolUse" },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({});
    expect(onPreflight).not.toHaveBeenCalled();
  });
});
