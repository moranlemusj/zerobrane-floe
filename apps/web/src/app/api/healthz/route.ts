import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createDb, indexerState, loans, markets } from "@floe-dashboard/data";

/**
 * GET /api/healthz — connectivity + last-block snapshot.
 *
 * Used by deploy smoke tests and the dashboard's footer "indexer status"
 * widget. Returns 200 if the DB is reachable and the schema looks sane.
 */
export async function GET() {
  try {
    const db = createDb();
    const [dbInfo, marketsCount, loansCount, lastBlock] = await Promise.all([
      db.execute(sql`SELECT now() AS now, current_database() AS db`),
      db.execute(sql`SELECT COUNT(*)::int AS c FROM ${markets}`),
      db.execute(sql`SELECT COUNT(*)::int AS c FROM ${loans}`),
      db
        .select()
        .from(indexerState)
        .where(sql`${indexerState.key} = 'lastBlock'`)
        .limit(1),
    ]);

    return NextResponse.json({
      ok: true,
      db: (dbInfo.rows[0] as { db: string }).db,
      now: (dbInfo.rows[0] as { now: string }).now,
      counts: {
        markets: (marketsCount.rows[0] as { c: number }).c,
        loans: (loansCount.rows[0] as { c: number }).c,
      },
      indexer: {
        lastBlock: lastBlock[0]?.value ?? null,
        lastBlockUpdatedAt: lastBlock[0]?.updatedAt ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
