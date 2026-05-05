import type {
  CreditRemaining,
  FloeClient,
  X402CostEstimate,
} from "@floe-agents/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { floeCodeExecNode } from "../floe-code-exec.js";
import type { WithFloeEvent } from "../types.js";

function makeRemaining(overrides: Partial<CreditRemaining> = {}): CreditRemaining {
  return {
    available: 0n,
    creditIn: 10_000_000n,
    creditOut: 0n,
    creditLimit: 10_000_000n,
    headroomToAutoBorrow: 10_000_000n,
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
    url: "https://api.example.com/exec",
    method: "POST",
    isX402: true,
    price: 50_000n,
    asset: "0xUSDC",
    network: "base",
    payTo: "0xpay",
    scheme: "exact",
    cached: false,
    fetchedAt: "t",
    reflection: {
      available: 0n,
      headroomToAutoBorrow: 10_000_000n,
      sessionSpendRemaining: null,
      willExceedAvailable: false,
      willExceedHeadroom: false,
      willExceedSpendLimit: false,
      ...reflection,
    },
  };
}

describe("floeCodeExecNode", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("preflight runs against the configured endpoint by default", async () => {
    let estimateUrl: string | undefined;
    const remainingQueue = [
      makeRemaining({ sessionSpent: 0n }),
      makeRemaining({ sessionSpent: 50_000n }),
    ];
    const client = {
      estimateX402Cost: vi.fn(async (input: { url: string }) => {
        estimateUrl = input.url;
        return makeEstimate();
      }),
      getCreditRemaining: vi.fn(async () => remainingQueue.shift() ?? makeRemaining()),
    } as unknown as FloeClient;

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          stdout: "",
          stderr: "",
          returned: "55",
          duration_ms: 5,
          paid_usdc: "50000",
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const events: WithFloeEvent[] = [];
    const node = floeCodeExecNode<{ code: string; execution?: unknown }>({
      endpoint: "https://api.example.com/exec",
      floe: { client, onEvent: (e) => events.push(e) },
    });
    const result = await node({ code: "return 55;" });

    expect(estimateUrl).toBe("https://api.example.com/exec");
    expect(result.execution).toMatchObject({
      ok: true,
      returned: "55",
      paidUsdc: "50000",
    });
    const consumed = events.find((e) => e.type === "credit_consumed");
    expect(consumed?.type === "credit_consumed" && consumed.deltaUsdc).toBe(50_000n);
  });

  it("respects custom inputKey and outputKey", async () => {
    const client = {
      estimateX402Cost: vi.fn(async () => makeEstimate()),
      getCreditRemaining: vi.fn(async () => makeRemaining()),
    } as unknown as FloeClient;

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          stdout: "",
          stderr: "",
          returned: "1",
          duration_ms: 0,
          paid_usdc: "0",
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const node = floeCodeExecNode<{ snippet: string; out?: unknown }>({
      endpoint: "https://api.example.com/exec",
      floe: { client },
      inputKey: "snippet",
      outputKey: "out",
    });
    const result = await node({ snippet: "return 1;" });
    expect(result.out).toBeDefined();
    expect((result.out as { returned: string }).returned).toBe("1");
  });

  it("proxy mode routes through client.proxyFetch", async () => {
    const proxyFetch = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: {
        ok: true,
        stdout: "",
        stderr: "",
        returned: "99",
        duration_ms: 1,
        paid_usdc: "10000",
      },
    }));
    const client = {
      estimateX402Cost: vi.fn(async () => makeEstimate({ available: 0n })),
      getCreditRemaining: vi.fn(async () => makeRemaining()),
      proxyFetch,
    } as unknown as FloeClient;

    const node = floeCodeExecNode<{ code: string; execution?: unknown }>({
      endpoint: "https://api.example.com/exec",
      proxy: { useFloeProxy: true },
      floe: { client },
    });
    const result = await node({ code: "return 99;" });
    expect(proxyFetch).toHaveBeenCalled();
    expect((result.execution as { returned: string }).returned).toBe("99");
  });
});
