import type { FloeClient, SpendLimit } from "@floe-agents/core";
import { describe, expect, it, vi } from "vitest";
import {
  floeApplySpendLimit,
  floeClearSpendLimit,
  floeGetSpendLimit,
} from "../hooks/spend-limit.js";

function makeFakeClient(spend: SpendLimit | null = null) {
  return {
    setSpendLimit: vi.fn(async ({ limit }: { limit: bigint }) => ({
      active: true,
      limit,
      sessionSpent: 0n,
      sessionRemaining: limit,
    })),
    clearSpendLimit: vi.fn(async () => undefined),
    getSpendLimit: vi.fn(async () => spend),
  } as unknown as FloeClient;
}

describe("floeApplySpendLimit", () => {
  it("calls client.setSpendLimit and returns the resulting SpendLimit", async () => {
    const client = makeFakeClient();
    const result = await floeApplySpendLimit({ client, limit: 5_000_000n });
    expect(client.setSpendLimit).toHaveBeenCalledWith({ limit: 5_000_000n });
    expect(result.active).toBe(true);
    expect(result.limit).toBe(5_000_000n);
    expect(result.sessionRemaining).toBe(5_000_000n);
  });
});

describe("floeClearSpendLimit", () => {
  it("calls client.clearSpendLimit", async () => {
    const client = makeFakeClient();
    await floeClearSpendLimit(client);
    expect(client.clearSpendLimit).toHaveBeenCalledOnce();
  });
});

describe("floeGetSpendLimit", () => {
  it("returns whatever client.getSpendLimit returns", async () => {
    const client = makeFakeClient(null);
    expect(await floeGetSpendLimit(client)).toBeNull();

    const limited = makeFakeClient({
      active: true,
      limit: 5_000_000n,
      sessionSpent: 1_000_000n,
      sessionRemaining: 4_000_000n,
    });
    expect((await floeGetSpendLimit(limited))?.sessionRemaining).toBe(4_000_000n);
  });
});
