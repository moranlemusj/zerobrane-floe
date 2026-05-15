import { describe, expect, it } from "vitest";
import { extractAmounts } from "../backfill-initial";
import {
  BORROWER,
  COLLATERAL_POSTED,
  COLLATERAL_TOKEN,
  LENDER,
  LOAN_TOKEN,
  MATCHED_PRINCIPAL,
  matchReceipt,
} from "./fixtures/match-receipt";

const tokens = {
  borrower: BORROWER,
  lender: LENDER,
  loanToken: LOAN_TOKEN,
  collateralToken: COLLATERAL_TOKEN,
};

describe("extractAmounts", () => {
  it("returns the MATCHED principal (lender's total commitment), not the net disbursement", () => {
    // The earlier walker matched the loanToken Transfer where
    // `to === borrower`, which captured the post-commission
    // disbursement (4.95 USDC). The actual matched principal — what the
    // borrower owes — is the lender's total loanToken commitment in the
    // tx (5.00 USDC). This test pins that invariant against the fixture.
    const result = extractAmounts(matchReceipt, tokens);
    expect(result).not.toBeNull();
    expect(result!.principal).toBe(MATCHED_PRINCIPAL);
    expect(result!.collateral).toBe(COLLATERAL_POSTED);
  });

  it("returns null when no loanToken transfers from the lender are present", () => {
    const stripped = {
      ...matchReceipt,
      logs: matchReceipt.logs.filter((l) => l.address !== LOAN_TOKEN),
    };
    expect(extractAmounts(stripped, tokens)).toBeNull();
  });

  it("returns null when collateral transfer from borrower is missing", () => {
    const stripped = {
      ...matchReceipt,
      logs: matchReceipt.logs.filter((l) => l.address !== COLLATERAL_TOKEN),
    };
    expect(extractAmounts(stripped, tokens)).toBeNull();
  });
});
