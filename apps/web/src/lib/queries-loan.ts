/**
 * Per-loan queries used by /loan/[loanId].
 */

import { desc, eq, sql } from "drizzle-orm";
import { events, loans } from "@floe-dashboard/data";
import { getDb, type LoanRow } from "./queries";

export async function getLoan(loanId: string): Promise<LoanRow | null> {
  const db = getDb();
  const rows = await db.select().from(loans).where(eq(loans.loanId, loanId)).limit(1);
  return (rows[0] as LoanRow | undefined) ?? null;
}

export interface LoanEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  eventName: string;
  args: Record<string, unknown>;
}

export async function getLoanEvents(loanId: string): Promise<LoanEvent[]> {
  const db = getDb();
  const rows = await db
    .select({
      txHash: events.txHash,
      logIndex: events.logIndex,
      blockNumber: events.blockNumber,
      blockTimestamp: events.blockTimestamp,
      eventName: events.eventName,
      args: events.args,
    })
    .from(events)
    .where(eq(events.loanId, loanId))
    .orderBy(desc(events.blockNumber));
  return rows.map((r) => ({
    ...r,
    args: (r.args ?? {}) as Record<string, unknown>,
  }));
}

/** Latest oracle answer for a token's collateral feed (by description match). */
export async function getOracleByDescription(
  description: string,
): Promise<{ description: string; decimals: number; latestAnswer: string } | null> {
  const db = getDb();
  const r = await db.execute(
    sql`SELECT description, decimals, latest_answer AS "latestAnswer" FROM oracles WHERE description = ${description} LIMIT 1`,
  );
  return (r.rows[0] as { description: string; decimals: number; latestAnswer: string } | undefined) ?? null;
}
