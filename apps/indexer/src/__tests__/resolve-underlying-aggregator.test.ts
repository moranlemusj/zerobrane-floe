import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { resolveUnderlyingAggregator } from "../oracle";
import type { IndexerClients } from "../clients";

/**
 * Chainlink uses an AggregatorProxy pattern: the proxy is what dApps
 * configure (stable address), and it forwards view reads to whichever
 * underlying aggregator implementation is currently live. But
 * `AnswerUpdated` events fire on the underlying — NOT the proxy.
 * Subscribing to the proxy is silent forever.
 *
 * `resolveUnderlyingAggregator` does the one-time `aggregator()` read
 * at subscribe-time so the subscriber attaches to the right address.
 */
describe("resolveUnderlyingAggregator", () => {
  it("returns the underlying aggregator address (checksummed) from the proxy", async () => {
    const readContract = vi.fn().mockResolvedValue(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
    const clients = {
      httpClient: { readContract },
    } as unknown as IndexerClients;

    const proxy = "0x71041dDdaD3595F9CEd3DcCFBe3D1F4b0a16Bb70" as `0x${string}`;
    const underlying = await resolveUnderlyingAggregator(clients, proxy);

    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: proxy,
        functionName: "aggregator",
      }),
    );
    // viem's getAddress returns the EIP-55 checksum form.
    expect(underlying).toBe(getAddress("0xabcdef0123456789abcdef0123456789abcdef01"));
  });

  it("propagates errors from the readContract call (callers wrap with try/catch)", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("rpc unreachable"));
    const clients = {
      httpClient: { readContract },
    } as unknown as IndexerClients;

    await expect(
      resolveUnderlyingAggregator(clients, "0x0000000000000000000000000000000000000001"),
    ).rejects.toThrow("rpc unreachable");
  });
});
