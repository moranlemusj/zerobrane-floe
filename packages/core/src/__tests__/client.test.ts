import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FloeClient, FloeClientError, createFloeClient } from "../client.js";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface MockFetchOptions {
  status?: number;
  body?: unknown;
  text?: string;
}

function makeMockFetch(): {
  fetch: typeof fetch;
  captured: CapturedRequest[];
  setNextResponse: (opts: MockFetchOptions) => void;
  setNextResponses: (responses: MockFetchOptions[]) => void;
} {
  const captured: CapturedRequest[] = [];
  let queued: MockFetchOptions[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headersInit = init?.headers ?? {};
    const headers: Record<string, string> = {};
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(headersInit)) {
      for (const pair of headersInit) {
        const k = pair[0];
        const v = pair[1];
        if (k !== undefined && v !== undefined) headers[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(headersInit)) headers[k.toLowerCase()] = String(v);
    }
    let body: unknown;
    if (init?.body !== undefined && init?.body !== null) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    captured.push({ url, method: init?.method ?? "GET", headers, body });
    const next = queued.shift() ?? { status: 200, body: { ok: true } };
    const status = next.status ?? 200;
    const responseBody = next.text ?? (next.body !== undefined ? JSON.stringify(next.body) : "");
    // 204 No Content / 205 Reset Content / 304 Not Modified must not have a body.
    const isEmptyByStatus = status === 204 || status === 205 || status === 304;
    return new Response(isEmptyByStatus ? null : responseBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetch: fetchImpl,
    captured,
    setNextResponse(opts) {
      queued = [opts];
    },
    setNextResponses(opts) {
      queued = [...opts];
    },
  };
}

describe("FloeClient — auth + transport", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({
      apiKey: "floe_live_test",
      baseUrl: "https://api.test/",
      fetch: mock.fetch,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips trailing slash from baseUrl", async () => {
    mock.setNextResponse({ body: { status: "ok", timestamp: "2026-05-05T00:00:00.000Z" } });
    await client.getHealth();
    expect(mock.captured[0]?.url).toBe("https://api.test/v1/health");
  });

  it("attaches Bearer header for authenticated endpoints", async () => {
    mock.setNextResponse({
      body: {
        available: "5000000",
        creditIn: "10000000",
        creditOut: "5000000",
        creditLimit: "10000000",
        headroomToAutoBorrow: "5000000",
        utilizationBps: 5000,
        sessionSpendLimit: null,
        sessionSpent: "0",
        sessionSpendRemaining: null,
        asOf: "2026-05-05T00:00:00.000Z",
      },
    });
    await client.getCreditRemaining();
    expect(mock.captured[0]?.headers.authorization).toBe("Bearer floe_live_test");
  });

  it("omits auth header for public endpoints", async () => {
    mock.setNextResponse({ body: { status: "ok", timestamp: "2026-05-05T00:00:00.000Z" } });
    await client.getHealth();
    expect(mock.captured[0]?.headers.authorization).toBeUndefined();
  });

  it("throws FloeClientError with status, path, method, body on non-ok", async () => {
    mock.setNextResponse({ status: 401, body: { error: "Unauthorized" } });
    await expect(client.getCreditRemaining()).rejects.toMatchObject({
      name: "FloeClientError",
      status: 401,
      path: "/v1/agents/credit-remaining",
      method: "GET",
      message: "Unauthorized",
    });
  });

  it("falls back to default error message when server omits one", async () => {
    mock.setNextResponse({ status: 500, text: "" });
    await expect(client.getCreditRemaining()).rejects.toThrow(/failed: 500/);
  });

  it("FloeClientError instance carries all fields", async () => {
    mock.setNextResponse({ status: 404, body: { error: "Not found" } });
    try {
      await client.getCreditRemaining();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FloeClientError);
      const e = err as FloeClientError;
      expect(e.status).toBe(404);
      expect(e.body).toEqual({ error: "Not found" });
    }
  });
});

describe("FloeClient — agent awareness", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({
      apiKey: "floe_live_test",
      baseUrl: "https://api.test",
      fetch: mock.fetch,
    });
  });

  it("getCreditRemaining converts decimal-string fields to bigint", async () => {
    mock.setNextResponse({
      body: {
        available: "6800000000",
        creditIn: "10000000000",
        creditOut: "3200000000",
        creditLimit: "10000000000",
        headroomToAutoBorrow: "6800000000",
        utilizationBps: 3200,
        sessionSpendLimit: "5000000",
        sessionSpent: "1200000",
        sessionSpendRemaining: "3800000",
        asOf: "2026-05-04T12:00:00.000Z",
      },
    });
    const result = await client.getCreditRemaining();
    expect(result.available).toBe(6_800_000_000n);
    expect(result.creditOut).toBe(3_200_000_000n);
    expect(result.headroomToAutoBorrow).toBe(6_800_000_000n);
    expect(result.utilizationBps).toBe(3200);
    expect(result.sessionSpendLimit).toBe(5_000_000n);
    expect(result.sessionSpent).toBe(1_200_000n);
    expect(result.sessionSpendRemaining).toBe(3_800_000n);
    expect(result.asOf).toBe("2026-05-04T12:00:00.000Z");
  });

  it("getCreditRemaining preserves null sessionSpendLimit", async () => {
    mock.setNextResponse({
      body: {
        available: "0",
        creditIn: "0",
        creditOut: "0",
        creditLimit: "10000000000",
        headroomToAutoBorrow: "10000000000",
        utilizationBps: 0,
        sessionSpendLimit: null,
        sessionSpent: "0",
        sessionSpendRemaining: null,
        asOf: "2026-05-05T00:00:00.000Z",
      },
    });
    const result = await client.getCreditRemaining();
    expect(result.sessionSpendLimit).toBeNull();
    expect(result.sessionSpendRemaining).toBeNull();
  });

  it("getLoanState passes through state name and parses nested USDC", async () => {
    mock.setNextResponse({
      body: {
        state: "borrowing",
        reason: "facility_loan_pending_match",
        details: {
          source: "facility",
          status: "pending_match",
          available: "0",
          creditLimit: "10000000000",
        },
      },
    });
    const result = await client.getLoanState();
    expect(result.state).toBe("borrowing");
    expect(result.reason).toBe("facility_loan_pending_match");
    expect(result.details?.available).toBe(0n);
    expect(result.details?.creditLimit).toBe(10_000_000_000n);
  });

  it("setSpendLimit sends PUT with limitRaw decimal string and parses response", async () => {
    mock.setNextResponse({
      body: {
        active: true,
        limitRaw: "5000000",
        sessionSpentRaw: "0",
        sessionRemainingRaw: "5000000",
      },
    });
    const result = await client.setSpendLimit({ limit: 5_000_000n });
    expect(mock.captured[0]?.method).toBe("PUT");
    expect(mock.captured[0]?.url).toBe("https://api.test/v1/agents/spend-limit");
    expect(mock.captured[0]?.body).toEqual({ limitRaw: "5000000" });
    expect(result.active).toBe(true);
    expect(result.limit).toBe(5_000_000n);
    expect(result.sessionRemaining).toBe(5_000_000n);
  });

  it("clearSpendLimit sends DELETE and accepts 204", async () => {
    mock.setNextResponse({ status: 204, text: "" });
    await client.clearSpendLimit();
    expect(mock.captured[0]?.method).toBe("DELETE");
  });

  it("getSpendLimit returns null when server returns null", async () => {
    mock.setNextResponse({ body: null });
    const result = await client.getSpendLimit();
    expect(result).toBeNull();
  });
});

describe("FloeClient — x402 + proxy", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({
      apiKey: "floe_live_test",
      baseUrl: "https://api.test",
      fetch: mock.fetch,
    });
  });

  it("estimateX402Cost POSTs body and parses reflection block", async () => {
    mock.setNextResponse({
      body: {
        url: "https://api.example.com/paid",
        method: "GET",
        x402: true,
        priceRaw: "5000",
        asset: "0xUSDC",
        network: "base",
        payTo: "0xPayTo",
        scheme: "exact",
        cached: false,
        fetchedAt: "2026-05-05T00:00:00.000Z",
        reflection: {
          available: "6800000000",
          headroomToAutoBorrow: "6800000000",
          sessionSpendRemaining: "3800000",
          willExceedAvailable: false,
          willExceedHeadroom: false,
          willExceedSpendLimit: false,
        },
      },
    });
    const result = await client.estimateX402Cost({ url: "https://api.example.com/paid" });
    expect(mock.captured[0]?.method).toBe("POST");
    expect(mock.captured[0]?.url).toBe("https://api.test/v1/x402/estimate");
    expect(mock.captured[0]?.body).toEqual({
      url: "https://api.example.com/paid",
      method: "GET",
    });
    expect(result.isX402).toBe(true);
    expect(result.price).toBe(5_000n);
    expect(result.reflection.willExceedHeadroom).toBe(false);
    expect(result.reflection.sessionSpendRemaining).toBe(3_800_000n);
  });

  it("proxyCheck calls public endpoint with url query, no auth header", async () => {
    mock.setNextResponse({
      body: { requiresPayment: true, price: "750000", currency: "USDC", network: "base" },
    });
    const result = await client.proxyCheck("https://api.example.com/data");
    expect(mock.captured[0]?.url).toBe(
      "https://api.test/v1/proxy/check?url=https%3A%2F%2Fapi.example.com%2Fdata",
    );
    expect(mock.captured[0]?.headers.authorization).toBeUndefined();
    expect(result.requiresPayment).toBe(true);
    expect(result.price).toBe(750_000n);
  });

  it("proxyFetch posts body with method/headers/body", async () => {
    mock.setNextResponse({
      body: { status: 200, headers: { "content-type": "application/json" }, body: { ok: true } },
    });
    await client.proxyFetch({
      url: "https://api.example.com/data",
      method: "POST",
      headers: { "X-Trace": "abc" },
      body: { hello: "world" },
    });
    expect(mock.captured[0]?.body).toEqual({
      url: "https://api.example.com/data",
      method: "POST",
      headers: { "X-Trace": "abc" },
      body: { hello: "world" },
    });
  });
});

describe("FloeClient — credit thresholds + agent lifecycle", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({
      apiKey: "floe_live_test",
      baseUrl: "https://api.test",
      fetch: mock.fetch,
    });
  });

  it("listCreditThresholds accepts both array and {thresholds: [...]} shapes", async () => {
    mock.setNextResponses([
      { body: [{ id: 1, thresholdBps: 8000, webhookId: 123, createdAt: "t" }] },
      {
        body: {
          thresholds: [{ id: "42", thresholdBps: 9000, webhookId: 124, createdAt: "u" }],
        },
      },
    ]);
    const a = await client.listCreditThresholds();
    expect(a[0]?.id).toBe("1");
    const b = await client.listCreditThresholds();
    expect(b[0]?.id).toBe("42");
  });

  it("registerAgent parses creditLimit raw string", async () => {
    mock.setNextResponse({
      body: {
        status: "active",
        apiKey: "floe_live_NEW",
        creditLimit: "10000000000",
        paymentWalletAddress: "0xabc",
      },
    });
    const result = await client.registerAgent({ delegationTxHash: "0xdef" });
    expect(result.apiKey).toBe("floe_live_NEW");
    expect(result.creditLimit).toBe(10_000_000_000n);
  });

  it("getAgentBalance parses activeLoans with principalRaw", async () => {
    mock.setNextResponse({
      body: {
        creditLimit: "10000000000",
        creditUsed: "3200000000",
        creditAvailable: "6800000000",
        activeLoans: [{ loanId: "42", principalRaw: "5000000000" }],
        delegationActive: true,
      },
    });
    const result = await client.getAgentBalance();
    expect(result.activeLoans[0]?.principal).toBe(5_000_000_000n);
    expect(result.delegationActive).toBe(true);
  });
});

describe("FloeClient — protocol-level credit", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({
      apiKey: "floe_live_test",
      baseUrl: "https://api.test",
      fetch: mock.fetch,
    });
  });

  it("instantBorrow sends decimal-string body and Idempotency-Key header when set", async () => {
    mock.setNextResponse({
      body: {
        attemptId: "pending:abc",
        status: "pending_funding",
        reused: false,
        transactions: [
          {
            to: "0xto",
            data: "0xdata",
            value: "0x0",
            chainId: 8453,
            description: "Approve",
          },
        ],
        selectedOffer: {
          offerHash: "0xhash",
          minInterestRateBps: "800",
          remainingAmount: "10000000000",
        },
      },
    });
    const result = await client.instantBorrow({
      marketId: "0xMarket",
      borrowAmount: 5_000_000_000n,
      collateralAmount: 2_000_000_000_000_000_000n,
      maxInterestRateBps: 1200,
      duration: 2_592_000,
      minLtvBps: 8000,
      maxLtvBps: 7500,
      idempotencyKey: "uuid-1",
    });
    expect(mock.captured[0]?.headers["idempotency-key"]).toBe("uuid-1");
    expect(mock.captured[0]?.body).toEqual({
      marketId: "0xMarket",
      borrowAmount: "5000000000",
      collateralAmount: "2000000000000000000",
      maxInterestRateBps: "1200",
      duration: "2592000",
      minLtvBps: "8000",
      maxLtvBps: "7500",
    });
    expect(result.attemptId).toBe("pending:abc");
    expect(result.transactions).toHaveLength(1);
    expect(result.selectedOffer?.minInterestRateBps).toBe(800);
    expect(result.selectedOffer?.remainingAmount).toBe(10_000_000_000n);
  });

  it("repayLoan POSTs decimal slippageBps", async () => {
    mock.setNextResponse({ body: { transactions: [] } });
    await client.repayLoan({ loanId: "42", slippageBps: 500 });
    expect(mock.captured[0]?.body).toEqual({ loanId: "42", slippageBps: "500" });
  });
});

describe("FloeClient — public endpoints", () => {
  let mock: ReturnType<typeof makeMockFetch>;
  let client: FloeClient;

  beforeEach(() => {
    mock = makeMockFetch();
    client = createFloeClient({ baseUrl: "https://api.test", fetch: mock.fetch });
  });

  it("getMarkets does not require apiKey", async () => {
    mock.setNextResponse({ body: { markets: [] } });
    await expect(client.getMarkets()).resolves.toBeDefined();
    expect(mock.captured[0]?.headers.authorization).toBeUndefined();
  });

  it("getCreditOffers serializes minAmount as raw decimal string", async () => {
    mock.setNextResponse({ body: { offers: [] } });
    await client.getCreditOffers({ minAmount: 5_000_000n, maxRateBps: 1200 });
    expect(mock.captured[0]?.url).toContain("minAmount=5000000");
    expect(mock.captured[0]?.url).toContain("maxRateBps=1200");
  });

  it("getCostOfCapital serializes path and query", async () => {
    mock.setNextResponse({ body: {} });
    await client.getCostOfCapital("0xMarket", { borrowAmount: 1_000_000_000n, duration: 86400 });
    expect(mock.captured[0]?.url).toBe(
      "https://api.test/v1/markets/0xMarket/cost-of-capital?borrowAmount=1000000000&duration=86400",
    );
  });

  it("authenticated method without apiKey throws Floe auth required", async () => {
    await expect(client.getCreditRemaining()).rejects.toThrow(/Floe auth required/);
  });
});

describe("FloeClient — wallet auth fallback", () => {
  it("uses wallet signer headers when no api key configured", async () => {
    const mock = makeMockFetch();
    const signer = vi.fn(async () => "0xsig");
    const client = createFloeClient({
      walletAddress: "0xabc",
      walletSigner: signer,
      baseUrl: "https://api.test",
      fetch: mock.fetch,
    });
    mock.setNextResponse({
      body: {
        available: "0",
        creditIn: "0",
        creditOut: "0",
        creditLimit: "0",
        headroomToAutoBorrow: "0",
        utilizationBps: 0,
        sessionSpendLimit: null,
        sessionSpent: "0",
        sessionSpendRemaining: null,
        asOf: "t",
      },
    });
    await client.getCreditRemaining();
    expect(mock.captured[0]?.headers["x-wallet-address"]).toBe("0xabc");
    expect(mock.captured[0]?.headers["x-signature"]).toBe("0xsig");
    expect(mock.captured[0]?.headers["x-timestamp"]).toMatch(/^\d+$/);
    expect(signer).toHaveBeenCalledOnce();
  });
});
