import { describe, expect, it } from "vitest";
import {
  formatAmount,
  healthBand,
  shortAddress,
  tokenInfo,
  toHumanNumber,
} from "@/lib/format";

describe("tokenInfo", () => {
  it("looks up known tokens case-insensitively", () => {
    expect(tokenInfo("0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
    expect(tokenInfo("0x4200000000000000000000000000000000000006")).toEqual({
      symbol: "WETH",
      decimals: 18,
    });
  });

  it("falls back to '?' for unknown tokens (18 decimals default)", () => {
    expect(tokenInfo("0x0000000000000000000000000000000000000000")).toEqual({
      symbol: "?",
      decimals: 18,
    });
  });
});

describe("formatAmount", () => {
  it("formats 5 USDC (5_000_000 raw, 6 decimals) as '5'", () => {
    expect(formatAmount("5000000", 6)).toBe("5");
  });

  it("formats fractional USDC with default 4 display decimals", () => {
    expect(formatAmount("5050000", 6)).toBe("5.05");
    expect(formatAmount("5000001", 6)).toBe("5"); // trailing zeros stripped after 4dp truncation
  });

  it("returns '—' for null", () => {
    expect(formatAmount(null, 6)).toBe("—");
  });

  it("handles 18-decimal WETH amounts", () => {
    // 0.003 WETH = 3_000_000_000_000_000 raw
    expect(formatAmount("3000000000000000", 18)).toBe("0.003");
  });

  it("formats negative amounts with leading '-'", () => {
    expect(formatAmount("-5000000", 6)).toBe("-5");
  });

  it("returns the raw string on malformed input rather than throwing", () => {
    expect(formatAmount("not-a-number", 6)).toBe("not-a-number");
  });
});

describe("toHumanNumber", () => {
  it("scales raw uint256 by decimals (lossy at >2^53 — caller's call)", () => {
    expect(toHumanNumber("5000000", 6)).toBe(5);
    expect(toHumanNumber("3000000000000000", 18)).toBeCloseTo(0.003, 10);
  });

  it("treats null as 0", () => {
    expect(toHumanNumber(null, 6)).toBe(0);
  });
});

describe("shortAddress", () => {
  it("middle-elides long addresses to first6…last4", () => {
    expect(shortAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(
      "0x8335…2913",
    );
  });

  it("returns short input unchanged", () => {
    expect(shortAddress("0xshort")).toBe("0xshort");
  });

  it("returns em-dash for null/undefined", () => {
    expect(shortAddress(null)).toBe("—");
    expect(shortAddress(undefined)).toBe("—");
  });
});

describe("healthBand", () => {
  const liq = 9000; // 90% liquidation threshold (typical)

  it("returns 'closed' for non-active loans", () => {
    expect(
      healthBand({
        state: "repaid",
        currentLtvBps: 7000,
        liquidationLtvBps: liq,
        isUnderwater: false,
      }),
    ).toBe("closed");
  });

  it("returns 'liquidatable' when the on-chain underwater flag is set", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: 8500,
        liquidationLtvBps: liq,
        isUnderwater: true,
      }),
    ).toBe("liquidatable");
  });

  it("returns 'liquidatable' when buffer (liq - current) is negative", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: 9500,
        liquidationLtvBps: liq,
        isUnderwater: false,
      }),
    ).toBe("liquidatable");
  });

  it("returns 'at_risk' when buffer is in (0, 500]", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: 8800, // buffer = 200
        liquidationLtvBps: liq,
        isUnderwater: false,
      }),
    ).toBe("at_risk");
  });

  it("returns 'warning' when buffer is in (500, 2000]", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: 7500, // buffer = 1500
        liquidationLtvBps: liq,
        isUnderwater: false,
      }),
    ).toBe("warning");
  });

  it("returns 'healthy' when buffer is ≥ 2000", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: 5000, // buffer = 4000
        liquidationLtvBps: liq,
        isUnderwater: false,
      }),
    ).toBe("healthy");
  });

  it("returns 'warning' when current LTV is unknown (no oracle data yet)", () => {
    expect(
      healthBand({
        state: "active",
        currentLtvBps: null,
        liquidationLtvBps: liq,
        isUnderwater: null,
      }),
    ).toBe("warning");
  });
});
