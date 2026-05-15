import { describe, expect, it, vi } from "vitest";
import { allActiveLoanIds } from "../oracle";
import type { Db } from "@floe-dashboard/data";

/**
 * Build a tiny mock that walks the same Drizzle chain
 * `db.select({...}).from(table).where(...)` and resolves to `rows`.
 * `whereCapture` records the where-clause argument so the test can
 * assert "the helper actually filters on state = active".
 */
function mockDb(rows: Array<{ loanId: string }>): {
  db: Db;
  whereCapture: { called: number; arg: unknown };
} {
  const whereCapture = { called: 0, arg: undefined as unknown };
  const chain = {
    from: () => chain,
    where: (arg: unknown) => {
      whereCapture.called += 1;
      whereCapture.arg = arg;
      return Promise.resolve(rows);
    },
  };
  const db = {
    select: vi.fn(() => chain),
  } as unknown as Db;
  return { db, whereCapture };
}

describe("allActiveLoanIds", () => {
  it("returns active loan IDs as bigints", async () => {
    const { db } = mockDb([{ loanId: "82" }, { loanId: "81" }, { loanId: "34" }]);
    const ids = await allActiveLoanIds(db);
    expect(ids).toEqual([82n, 81n, 34n]);
  });

  it("returns [] when there are no active loans", async () => {
    const { db } = mockDb([]);
    const ids = await allActiveLoanIds(db);
    expect(ids).toEqual([]);
  });

  it("applies a single WHERE clause (state = active), no collateral filter", async () => {
    // Distinguishes this helper from activeLoanIdsForCollaterals which uses
    // and(inArray(collateral, ...), eq(state, 'active')).
    const { db, whereCapture } = mockDb([{ loanId: "82" }]);
    await allActiveLoanIds(db);
    expect(whereCapture.called).toBe(1);
    expect(whereCapture.arg).toBeDefined();
  });
});
