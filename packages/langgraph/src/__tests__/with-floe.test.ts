import type {
  CreditRemaining,
  FloeClient,
  X402CostEstimate,
} from "@floe-agents/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WithFloeEvent } from "../types.js";
import { withFloe } from "../with-floe.js";

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
    asOf: "t",
    ...overrides,
  };
}

function makeEstimate(reflection: Partial<X402CostEstimate["reflection"]> = {}): X402CostEstimate {
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
    fetchedAt: "t",
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

interface FakeClientOpts {
  remainingSequence?: CreditRemaining[];
  estimate?: X402CostEstimate;
  estimateError?: Error;
  remainingError?: Error;
}

function makeFakeClient({ remainingSequence, estimate, estimateError, remainingError }: FakeClientOpts = {}) {
  const queue = remainingSequence ? [...remainingSequence] : [];
  const getCreditRemaining = vi.fn(async () => {
    if (remainingError) throw remainingError;
    return queue.shift() ?? makeRemaining();
  });
  const estimateX402Cost = vi.fn(async () => {
    if (estimateError) throw estimateError;
    return estimate ?? makeEstimate();
  });
  return { getCreditRemaining, estimateX402Cost } as unknown as FloeClient;
}

describe("withFloe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits preflight_ok + node_started + node_completed for a healthy run with no extractor", async () => {
    const client = makeFakeClient({
      remainingSequence: [
        makeRemaining({ utilizationBps: 1000 }),
        makeRemaining({ utilizationBps: 1000 }),
      ],
    });
    const events: WithFloeEvent[] = [];
    const inner = vi.fn(async (s: { x: number }) => ({ x: s.x + 1 }));

    const node = withFloe(inner, { client, onEvent: (e) => events.push(e) });
    const result = await node({ x: 1 });

    expect(result).toEqual({ x: 2 });
    expect(inner).toHaveBeenCalledOnce();
    const types = events.map((e) => e.type);
    expect(types).toContain("preflight_ok");
    expect(types).toContain("node_started");
    expect(types).toContain("node_completed");
    expect(types).toContain("credit_consumed");
  });

  it("emits low_credit warning when utilization >= warnAtUtilizationBps", async () => {
    const client = makeFakeClient({
      remainingSequence: [
        makeRemaining({ utilizationBps: 9000 }),
        makeRemaining({ utilizationBps: 9000 }),
      ],
    });
    const events: WithFloeEvent[] = [];
    const node = withFloe<Record<string, unknown>>(async (s) => s, {
      client,
      preflight: { warnAtUtilizationBps: 8000 },
      onEvent: (e) => events.push(e),
    });
    await node({});
    const warning = events.find((e) => e.type === "preflight_warning");
    expect(warning).toBeDefined();
    if (warning?.type === "preflight_warning") {
      expect(warning.reason).toBe("low_credit");
    }
  });

  it("uses estimateX402Cost when extractor returns a URL and emits would_exceed", async () => {
    const client = makeFakeClient({
      estimate: makeEstimate({ willExceedAvailable: true, willExceedHeadroom: true }),
    });
    const events: WithFloeEvent[] = [];
    const node = withFloe<Record<string, unknown>>(async (s) => s, {
      client,
      preflight: { estimate: () => ({ url: "https://api.example.com/x" }) },
      onEvent: (e) => events.push(e),
    });
    await node({});
    expect(client.estimateX402Cost).toHaveBeenCalledWith({
      url: "https://api.example.com/x",
    });
    const w = events.find((e) => e.type === "preflight_warning");
    expect(w?.type === "preflight_warning" && w.reason).toBe("would_exceed");
  });

  it("emits spend_limit_blocked when willExceedSpendLimit is set", async () => {
    const client = makeFakeClient({
      estimate: makeEstimate({
        willExceedAvailable: true,
        willExceedHeadroom: true,
        willExceedSpendLimit: true,
      }),
    });
    const events: WithFloeEvent[] = [];
    const node = withFloe<Record<string, unknown>>(async (s) => s, {
      client,
      preflight: { estimate: () => ({ url: "https://x" }) },
      onEvent: (e) => events.push(e),
    });
    await node({});
    const w = events.find((e) => e.type === "preflight_warning");
    expect(w?.type === "preflight_warning" && w.reason).toBe("spend_limit_blocked");
  });

  it("derives credit_consumed delta from sessionSpent diff", async () => {
    const client = makeFakeClient({
      remainingSequence: [
        makeRemaining({ sessionSpent: 0n }),
        makeRemaining({ sessionSpent: 50_000n }),
      ],
    });
    const events: WithFloeEvent[] = [];
    const node = withFloe(async () => ({}), {
      client,
      onEvent: (e) => events.push(e),
    });
    await node({});
    const consumed = events.find((e) => e.type === "credit_consumed");
    expect(consumed).toBeDefined();
    if (consumed?.type === "credit_consumed") {
      expect(consumed.deltaUsdc).toBe(50_000n);
    }
  });

  it("inner-node errors propagate after emitting error event", async () => {
    const client = makeFakeClient();
    const events: WithFloeEvent[] = [];
    const err = new Error("boom");
    const node = withFloe(
      async () => {
        throw err;
      },
      { client, onEvent: (e) => events.push(e) },
    );
    await expect(node({})).rejects.toThrow("boom");
    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent?.type === "error" && errEvent.phase).toBe("node");
  });

  it("preflight errors do not block the inner node", async () => {
    const client = makeFakeClient({ remainingError: new Error("network") });
    const events: WithFloeEvent[] = [];
    const inner = vi.fn(async (s: object) => s);
    const node = withFloe(inner, { client, onEvent: (e) => events.push(e) });
    await node({});
    expect(inner).toHaveBeenCalledOnce();
    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent?.type === "error" && errEvent.phase).toBe("preflight");
  });

  it("trackSpend=false skips the post-snapshot read", async () => {
    const client = makeFakeClient();
    const node = withFloe(async () => ({}), { client, trackSpend: false });
    await node({});
    // 1 call for preflight, 0 for post (no extractor → only the preflight read).
    expect(client.getCreditRemaining).toHaveBeenCalledTimes(1);
  });
});
