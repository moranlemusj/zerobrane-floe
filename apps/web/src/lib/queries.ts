/**
 * Server-side DB queries used by the dashboard pages.
 * Built atop @floe-dashboard/data Drizzle schema.
 */

import { type SQL, and, asc, count, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { createDb, type Loan, loans, markets, oracles } from "@floe-dashboard/data";

export type LoanRow = Loan;

export interface LoanFilter {
  marketId?: string;
  state?: string;
  borrower?: string;
  collateralToken?: string;
  minLtvBps?: number;
  maxLtvBps?: number;
}

export interface LoanQueryOptions {
  filter?: LoanFilter;
  sort?: "currentLtv" | "principal" | "startTime" | "loanId";
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
  if (filter?.state) conditions.push(eq(loans.state, filter.state as LoanRow["state"]));
  if (filter?.borrower)
    conditions.push(ilike(loans.borrower, `%${filter.borrower.toLowerCase()}%`));
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

export async function listLoans(opts: LoanQueryOptions = {}): Promise<{
  rows: LoanRow[];
  total: number;
}> {
  const db = getDb();
  const where = buildLoanWhere(opts.filter);

  const sortCol = (() => {
    switch (opts.sort) {
      case "principal":
        return loans.principalRaw;
      case "startTime":
        return loans.startTime;
      case "loanId":
        return sql`CAST(${loans.loanId} AS BIGINT)`;
      default:
        return loans.currentLtvBps;
    }
  })();
  const dir = opts.direction === "asc" ? asc : desc;
  const orderBy =
    opts.sort === "currentLtv" || !opts.sort
      ? sql`${sortCol} ${opts.direction === "asc" ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`}`
      : dir(sortCol);

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
  const lastBlock = await db.execute(sql`SELECT value FROM indexer_state WHERE key = 'lastBlock'`);
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
    lastBlock: (lastBlock.rows[0] as { value: string } | undefined)?.value ?? null,
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
