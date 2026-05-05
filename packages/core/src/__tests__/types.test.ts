import { describe, expect, it } from "vitest";
import {
  USDC_UNIT,
  formatUsdc,
  fromUsdc,
  parseRaw,
  toRaw,
  toUsdc,
} from "../types.js";

describe("USDC_UNIT", () => {
  it("is 1_000_000n (1 USDC at 6 decimals)", () => {
    expect(USDC_UNIT).toBe(1_000_000n);
  });
});

describe("toUsdc / fromUsdc", () => {
  it("round-trips integer USDC", () => {
    expect(fromUsdc(toUsdc("1"))).toBe("1");
    expect(fromUsdc(toUsdc("1000000"))).toBe("1000000");
  });

  it("round-trips fractional USDC", () => {
    expect(fromUsdc(toUsdc("1.5"))).toBe("1.5");
    expect(fromUsdc(toUsdc("0.000001"))).toBe("0.000001");
    expect(fromUsdc(toUsdc("0.123456"))).toBe("0.123456");
  });

  it("handles zero", () => {
    expect(toUsdc("0")).toBe(0n);
    expect(toUsdc("0.0")).toBe(0n);
    expect(fromUsdc(0n)).toBe("0");
  });

  it("handles negatives", () => {
    expect(toUsdc("-1.5")).toBe(-1_500_000n);
    expect(fromUsdc(-1_500_000n)).toBe("-1.5");
  });

  it("truncates beyond 6 decimals", () => {
    // 7th decimal is dropped (floor toward zero).
    expect(toUsdc("0.0000001")).toBe(0n);
    expect(toUsdc("1.1234567")).toBe(1_123_456n);
  });

  it("accepts numbers", () => {
    expect(toUsdc(1.5)).toBe(1_500_000n);
    expect(toUsdc(0)).toBe(0n);
  });

  it("rejects garbage", () => {
    expect(() => toUsdc("abc")).toThrow();
    expect(() => toUsdc("1.2.3")).toThrow();
    expect(() => toUsdc("")).toThrow();
    expect(() => toUsdc(Number.NaN)).toThrow();
    expect(() => toUsdc(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("handles very large amounts (>2^53)", () => {
    // 1 trillion USDC = 1e12 * 1e6 raw = 1e18 raw. Past Number.MAX_SAFE_INTEGER.
    const big = "1000000000000";
    const raw = toUsdc(big);
    expect(raw).toBe(1_000_000_000_000_000_000n);
    expect(fromUsdc(raw)).toBe(big);
  });
});

describe("formatUsdc", () => {
  it("appends 'USDC' by default", () => {
    expect(formatUsdc(1_500_000n)).toBe("1.5 USDC");
  });
  it("can omit symbol", () => {
    expect(formatUsdc(1_500_000n, { symbol: false })).toBe("1.5");
  });
  it("formats zero", () => {
    expect(formatUsdc(0n)).toBe("0 USDC");
  });
});

describe("parseRaw / toRaw", () => {
  it("round-trips", () => {
    expect(parseRaw(toRaw(1_500_000n))).toBe(1_500_000n);
  });
  it("rejects fractional raw", () => {
    expect(() => parseRaw("1.5")).toThrow();
    expect(() => parseRaw("abc")).toThrow();
  });
  it("emits decimal string", () => {
    expect(toRaw(5_000_000n)).toBe("5000000");
  });
});
