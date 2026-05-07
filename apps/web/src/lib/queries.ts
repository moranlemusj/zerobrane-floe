/**
 * Server-side DB queries used by the dashboard pages.
 * Built atop @floe-dashboard/data Drizzle schema.
 */

import { type SQL, and, asc, count, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { createDb, type Loan, loans, markets, oracles } from "@floe-dashboard/data";

export type LoanRow = Loan;

export type StatusFilter =
  | "healthy"
  | "warning"
  | "at_risk"
  | "liquidatable"
  | "repaid"
  | "liquidated"
  | "expired"
  | "pending";

export interface LoanFilter {
  marketId?: string;
  /** Display-band filter (mirrors the Status pill — health for active loans, lifecycle for closed). */
  status?: StatusFilter;
  borrower?: string;
  lender?: string;
  collateralToken?: string;
  minLtvBps?: number;
  maxLtvBps?: number;
}

export interface LoanQueryOptions {
  filter?: LoanFilter;
  sort?:
    | "currentLtv"
    | "principal"
    | "startTime"
    | "loanId"
    | "matchedAt"
    | "closedAt"
    | "heldDuration"
    | "interestPaid"
    | "interestRate"
    | "initialLtv"
    | "status";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function getDb() {
  return createDb();
}

function buildLoanWhere(filter: LoanFilter | undefined): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter?.marketId) conditions.push(eq(loans.marketId, filter.marketId));
  const statusCond = buildStatusCondition(filter?.status);
  if (statusCond) conditions.push(statusCond);
  if (filter?.borrower)
    conditions.push(ilike(loans.borrower, `%${filter.borrower.toLowerCase()}%`));
  if (filter?.lender)
    conditions.push(ilike(loans.lender, `%${filter.lender.toLowerCase()}%`));
  if (filter?.collateralToken)
    conditions.push(eq(loans.collateralToken, filter.collateralToken.toLowerCase()));
  if (filter?.minLtvBps !== undefined)
    conditions.push(gte(loans.currentLtvBps, filter.minLtvBps));
  if (filter?.maxLtvBps !== undefined)
    conditions.push(lte(loans.currentLtvBps, filter.maxLtvBps));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

/**
 * Map a display-band filter (matches the StatusPill labels) to its SQL
 * predicate. Active-state bands derive from current LTV vs liquidation
 * LTV (matching healthBand() in lib/format.ts); closed-state values
 * just compare the lifecycle column.
 */
function buildStatusCondition(status: StatusFilter | undefined): SQL | undefined {
  if (!status) return undefined;
  switch (status) {
    case "repaid":
    case "liquidated":
    case "expired":
    case "pending":
      return eq(loans.state, status);
    case "liquidatable":
      // Active loan whose buffer is gone (or chain says underwater).
      return sql`${loans.state} = 'active' AND (
        ${loans.isUnderwater} = true
        OR (${loans.currentLtvBps} IS NOT NULL AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 0)
      )`;
    case "at_risk":
      return sql`${loans.state} = 'active' AND ${loans.isUnderwater} IS NOT TRUE
        AND ${loans.currentLtvBps} IS NOT NULL
        AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} >= 0
        AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 500`;
    case "warning":
      // Either buffer in the warning band, or LTV unknown (we render warning
      // for unknown LTV in healthBand() — keep the SQL aligned).
      return sql`${loans.state} = 'active' AND ${loans.isUnderwater} IS NOT TRUE
        AND (
          ${loans.currentLtvBps} IS NULL
          OR (
            ${loans.liquidationLtvBps} - ${loans.currentLtvBps} >= 500
            AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 2000
          )
        )`;
    case "healthy":
      return sql`${loans.state} = 'active' AND ${loans.isUnderwater} IS NOT TRUE
        AND ${loans.currentLtvBps} IS NOT NULL
        AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} >= 2000`;
  }
}

export async function listLoans(opts: LoanQueryOptions = {}): Promise<{
  rows: LoanRow[];
  total: number;
}> {
  const db = getDb();
  const where = buildLoanWhere(opts.filter);

  const sortCol = (() => {
    switch (opts.sort) {
      case "principal":
        // Sort by initial principal — that's what the "Borrowed" column shows
        // and is meaningful across active+repaid loans (repaid loans have
        // current principal=0 on chain).
        return sql`COALESCE(${loans.initialPrincipalRaw}, ${loans.principalRaw})`;
      case "startTime":
        return loans.startTime;
      case "loanId":
        return sql`CAST(${loans.loanId} AS BIGINT)`;
      case "matchedAt":
        return loans.matchedAtTimestamp;
      case "closedAt":
        return loans.closedAtTimestamp;
      case "heldDuration":
        // Closed loans WITHOUT a close timestamp are honestly unknown;
        // collapse to NULL so they sink under NULLS LAST instead of
        // being treated as "held since match until now" (which the UI
        // correctly renders as "—" but the sort would otherwise rank
        // at the top).
        return sql`CASE
          WHEN ${loans.matchedAtTimestamp} IS NULL THEN NULL
          WHEN ${loans.closedAtTimestamp} IS NOT NULL
            THEN ${loans.closedAtTimestamp} - ${loans.matchedAtTimestamp}
          WHEN ${loans.state} = 'active'
            THEN EXTRACT(EPOCH FROM NOW())::bigint - ${loans.matchedAtTimestamp}
          ELSE NULL
        END`;
      case "interestPaid":
        return loans.totalInterestPaidRaw;
      case "interestRate":
        return loans.interestRateBps;
      case "initialLtv":
        return loans.ltvBps;
      case "status":
        // Severity rank — worst first when sorted ASC (1 = liquidatable,
        // 8 = repaid). Mirrors the buckets in buildStatusCondition() and
        // the displayed Status pill.
        return sql`CASE
          WHEN ${loans.state} = 'active' AND (
            ${loans.isUnderwater} = true
            OR (${loans.currentLtvBps} IS NOT NULL AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 0)
          ) THEN 1
          WHEN ${loans.state} = 'active' AND ${loans.currentLtvBps} IS NOT NULL
            AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} >= 0
            AND ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 500 THEN 2
          WHEN ${loans.state} = 'active' AND (
            ${loans.currentLtvBps} IS NULL
            OR ${loans.liquidationLtvBps} - ${loans.currentLtvBps} < 2000
          ) THEN 3
          WHEN ${loans.state} = 'active' THEN 4
          WHEN ${loans.state} = 'pending' THEN 5
          WHEN ${loans.state} = 'liquidated' THEN 6
          WHEN ${loans.state} = 'expired' THEN 7
          WHEN ${loans.state} = 'repaid' THEN 8
          ELSE 9
        END`;
      default:
        return loans.currentLtvBps;
    }
  })();
  // NULLs LAST for everything: a closed loan with no close timestamp,
  // or an active loan with no interest paid, should sink rather than
  // dominate the head of the list.
  const orderBy = sql`${sortCol} ${
    opts.direction === "asc" ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`
  }`;

  const baseQuery = db
    .select()
    .from(loans)
    .orderBy(orderBy)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  const rows = await (where ? baseQuery.where(where) : baseQuery);

  const totalResult = await (where
    ? db.select({ c: count() }).from(loans).where(where)
    : db.select({ c: count() }).from(loans));
  const total = Number(totalResult[0]?.c ?? 0);

  return { rows: rows as LoanRow[], total };
}

export interface KpiSummary {
  totalLoans: number;
  activeLoans: number;
  repaidLoans: number;
  liquidatedLoans: number;
  underwaterLoans: number;
  totalPrincipalActiveRaw: string;
  marketCount: number;
  lastBlock: string | null;
  lastReconciledAt: string | null; // ISO timestamp; null on fresh DB
}

export async function getKpis(): Promise<KpiSummary> {
  const db = getDb();
  const summary = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE state = 'active')::int AS active,
      COUNT(*) FILTER (WHERE state = 'repaid')::int AS repaid,
      COUNT(*) FILTER (WHERE state = 'liquidated')::int AS liquidated,
      COUNT(*) FILTER (WHERE is_underwater = true)::int AS underwater,
      COALESCE(SUM(principal_raw) FILTER (WHERE state = 'active'), 0)::text AS active_principal
    FROM loans
  `);
  const marketCount = await db.select({ c: count() }).from(markets);
  const lastBlock = await db.execute(
    sql`SELECT value, updated_at FROM indexer_state WHERE key = 'lastBlock'`,
  );
  const r = summary.rows[0] as {
    total: number;
    active: number;
    repaid: number;
    liquidated: number;
    underwater: number;
    active_principal: string;
  };
  return {
    totalLoans: r.total,
    activeLoans: r.active,
    repaidLoans: r.repaid,
    liquidatedLoans: r.liquidated,
    underwaterLoans: r.underwater,
    totalPrincipalActiveRaw: r.active_principal,
    marketCount: Number(marketCount[0]?.c ?? 0),
    lastBlock:
      (lastBlock.rows[0] as { value: string } | undefined)?.value ?? null,
    lastReconciledAt:
      (lastBlock.rows[0] as { updated_at: string | Date } | undefined)?.updated_at?.toString() ?? null,
  };
}

export async function listMarkets() {
  const db = getDb();
  return db.select().from(markets);
}

export async function listOracles() {
  const db = getDb();
  return db.select().from(oracles);
}

/** Loan counts grouped by marketId — includes markets that aren't in our markets table. */
export async function loansByMarket(): Promise<
  Array<{ marketId: string; total: number; active: number; outstandingPrincipalRaw: string }>
> {
  const db = getDb();
  const r = await db.execute(sql`
    SELECT
      market_id AS "marketId",
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE state = 'active')::int AS active,
      COALESCE(SUM(principal_raw) FILTER (WHERE state = 'active'), 0)::text AS "outstandingPrincipalRaw"
    FROM loans
    GROUP BY market_id
    ORDER BY active DESC, total DESC
  `);
  return r.rows as Array<{
    marketId: string;
    total: number;
    active: number;
    outstandingPrincipalRaw: string;
  }>;
}

export interface AddressStats {
  asBorrower: number;
  asLender: number;
  asOperator: number;
  activeAsBorrower: number;
  activeAsLender: number;
  totalBorrowedRaw: string; // sum of initial principals (loan-token base units, USDC ≈ 6 decimals)
  totalLentRaw: string;
  totalInterestPaidRaw: string;
}

/**
 * Roll-up stats for a single wallet across all loans where it's the
 * borrower, lender, or operator. Returns zeros (not nulls) when the
 * address has no involvement, so callers can render unconditionally.
 */
export async function getAddressStats(addr: string): Promise<AddressStats> {
  const db = getDb();
  const lower = addr.toLowerCase();
  const r = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE borrower = ${lower})::int AS as_borrower,
      COUNT(*) FILTER (WHERE lender   = ${lower})::int AS as_lender,
      COUNT(*) FILTER (WHERE operator = ${lower})::int AS as_operator,
      COUNT(*) FILTER (WHERE borrower = ${lower} AND state = 'active')::int AS active_as_borrower,
      COUNT(*) FILTER (WHERE lender   = ${lower} AND state = 'active')::int AS active_as_lender,
      COALESCE(SUM(initial_principal_raw) FILTER (WHERE borrower = ${lower}), 0)::text AS total_borrowed_raw,
      COALESCE(SUM(initial_principal_raw) FILTER (WHERE lender   = ${lower}), 0)::text AS total_lent_raw,
      COALESCE(SUM(total_interest_paid_raw) FILTER (WHERE borrower = ${lower}), 0)::text AS total_interest_paid_raw
    FROM loans
  `);
  const row = r.rows[0] as Record<string, unknown>;
  return {
    asBorrower: Number(row.as_borrower ?? 0),
    asLender: Number(row.as_lender ?? 0),
    asOperator: Number(row.as_operator ?? 0),
    activeAsBorrower: Number(row.active_as_borrower ?? 0),
    activeAsLender: Number(row.active_as_lender ?? 0),
    totalBorrowedRaw: String(row.total_borrowed_raw ?? "0"),
    totalLentRaw: String(row.total_lent_raw ?? "0"),
    totalInterestPaidRaw: String(row.total_interest_paid_raw ?? "0"),
  };
}
