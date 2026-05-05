import { describe, expect, it, vi } from "vitest";
import { buildAuthHeaders } from "../auth.js";

describe("buildAuthHeaders", () => {
  it("api_key mode emits Bearer header", async () => {
    const headers = await buildAuthHeaders({ apiKey: "floe_live_test" });
    expect(headers).toEqual({ Authorization: "Bearer floe_live_test" });
  });

  it("public mode emits no headers", async () => {
    const headers = await buildAuthHeaders({}, "public");
    expect(headers).toEqual({});
  });

  it("falls back to wallet when no api key but signer present", async () => {
    const signer = vi.fn(async () => "0xdeadbeef");
    const headers = await buildAuthHeaders({
      walletAddress: "0xabc",
      walletSigner: signer,
    });
    expect(headers["X-Wallet-Address"]).toBe("0xabc");
    expect(headers["X-Signature"]).toBe("0xdeadbeef");
    expect(headers["X-Timestamp"]).toMatch(/^\d+$/);
    expect(signer).toHaveBeenCalledOnce();
    expect(signer).toHaveBeenCalledWith(
      expect.objectContaining({ address: "0xabc", timestamp: expect.any(Number) }),
    );
  });

  it("wallet mode prefers wallet even when api key is also provided", async () => {
    const signer = vi.fn(async () => "0xfeed");
    const headers = await buildAuthHeaders(
      { apiKey: "floe_live_test", walletAddress: "0xabc", walletSigner: signer },
      "wallet",
    );
    expect(headers["X-Signature"]).toBe("0xfeed");
    expect(headers.Authorization).toBeUndefined();
  });

  it("wallet mode falls back to api key when no signer present", async () => {
    const headers = await buildAuthHeaders({ apiKey: "floe_live_test" }, "wallet");
    expect(headers).toEqual({ Authorization: "Bearer floe_live_test" });
  });

  it("api_key mode without any auth throws", async () => {
    await expect(buildAuthHeaders({})).rejects.toThrow(/Floe auth required/);
  });

  it("wallet mode without any auth throws", async () => {
    await expect(buildAuthHeaders({}, "wallet")).rejects.toThrow(/Floe wallet auth required/);
  });
});
