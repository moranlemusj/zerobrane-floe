/**
 * Indexer-state helpers — `indexer_state` is a key/value table.
 * Currently the only key is `lastBlock`, but we use the same shape for
 * any future bookkeeping (last reconcile time, last oracle round, etc.).
 */

import { eq } from "drizzle-orm";
import type { Db } from "@floe-dashboard/data";
import { indexerState } from "@floe-dashboard/data";

export async function getStateValue(db: Db, key: string): Promise<string | null> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setStateValue(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(indexerState)
    .values({ key, value })
    .onConflictDoUpdate({ target: indexerState.key, set: { value, updatedAt: new Date() } });
}

export async function getLastBlock(db: Db): Promise<bigint> {
  const v = await getStateValue(db, "lastBlock");
  return v ? BigInt(v) : 0n;
}

export async function setLastBlock(db: Db, block: bigint): Promise<void> {
  await setStateValue(db, "lastBlock", block.toString());
}
