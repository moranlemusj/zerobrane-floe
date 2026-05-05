import { describe, expect, it } from "vitest";
import { bpsToNumber, numberToInt, rawToUsdc, rawToUsdcNullable, usdcToRaw } from "../coerce.js";

describe("rawToUsdc", () => {
  it("converts decimal string", () => {
    expect(rawToUsdc("5000000")).toBe(5_000_000n);
  });
  it("treats empty/null as zero", () => {
    expect(rawToUsdc(null)).toBe(0n);
    expect(rawToUsdc(undefined)).toBe(0n);
    expect(rawToUsdc("")).toBe(0n);
  });
  it("converts integer number", () => {
    expect(rawToUsdc(5_000_000)).toBe(5_000_000n);
  });
  it("throws on garbage", () => {
    expect(() => rawToUsdc("1.5")).toThrow();
    expect(() => rawToUsdc("abc")).toThrow();
    expect(() => rawToUsdc(Number.NaN)).toThrow();
  });
});

describe("rawToUsdcNullable", () => {
  it("preserves null/undefined", () => {
    expect(rawToUsdcNullable(null)).toBeNull();
    expect(rawToUsdcNullable(undefined)).toBeNull();
  });
  it("converts string", () => {
    expect(rawToUsdcNullable("5000000")).toBe(5_000_000n);
  });
});

describe("usdcToRaw", () => {
  it("emits decimal string", () => {
    expect(usdcToRaw(5_000_000n)).toBe("5000000");
    expect(usdcToRaw(0n)).toBe("0");
    expect(usdcToRaw(-1n)).toBe("-1");
  });
});

describe("bpsToNumber", () => {
  it("parses string bps", () => {
    expect(bpsToNumber("8000")).toBe(8000);
  });
  it("passes through number", () => {
    expect(bpsToNumber(8000)).toBe(8000);
  });
  it("throws on garbage", () => {
    expect(() => bpsToNumber("abc")).toThrow();
  });
});

describe("numberToInt", () => {
  it("parses integer string", () => {
    expect(numberToInt("42")).toBe(42);
  });
  it("truncates floating number", () => {
    expect(numberToInt(42.9)).toBe(42);
  });
  it("rejects non-finite", () => {
    expect(() => numberToInt(Number.NaN)).toThrow();
  });
});
