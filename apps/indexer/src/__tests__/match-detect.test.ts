import { describe, expect, it } from "vitest";
import { containsNewMatch } from "../match-detect";

describe("containsNewMatch", () => {
  it("returns true when batch contains LogIntentsMatched", () => {
    expect(containsNewMatch(["LogLoanRepaid", "LogIntentsMatched"])).toBe(true);
  });

  it("returns true when batch is only LogIntentsMatched", () => {
    expect(containsNewMatch(["LogIntentsMatched"])).toBe(true);
  });

  it("returns false for unrelated lifecycle events", () => {
    expect(
      containsNewMatch(["LogLoanRepaid", "LogCollateralAdded", "LogLiquidated"]),
    ).toBe(false);
  });

  it("returns false for empty batch", () => {
    expect(containsNewMatch([])).toBe(false);
  });

  it("ignores null/undefined entries (events the decoder couldn't name)", () => {
    expect(containsNewMatch([null, undefined, "LogIntentsMatched"])).toBe(true);
    expect(containsNewMatch([null, undefined])).toBe(false);
  });
});
