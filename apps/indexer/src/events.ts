/**
 * applyEvent — persist a raw chain log to the events table and decode
 * any loanId references for downstream hydration.
 */

import { type AbiEvent, type Log, decodeEventLog } from "viem";
import type { Db } from "@floe-dashboard/data";
import { events } from "@floe-dashboard/data";

export interface ApplyEventResult {
  eventName: string;
  decoded: boolean;
  loanIds: bigint[];
}

export async function applyEvent(
  db: Db,
  decoderAbi: AbiEvent[],
  log: Log,
  blockTimestamp: bigint,
): Promise<ApplyEventResult> {
  let decoded: { eventName: string; args: Record<string, unknown> } | null = null;
  try {
    const result = decodeEventLog({
      abi: decoderAbi,
      data: log.data,
      topics: log.topics,
    }) as { eventName: string; args: Record<string, unknown> | undefined };
    decoded = { eventName: result.eventName, args: result.args ?? {} };
  } catch {
    // Unknown topic0 — still persist the raw log for audit trail.
  }

  const loanIds = decoded ? extractLoanIds(decoded.args) : [];

  const argsJson = decoded
    ? JSON.parse(JSON.stringify(decoded.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
    : { topics: log.topics, data: log.data };

  await db
    .insert(events)
    .values({
      txHash: log.transactionHash ?? "",
      logIndex: log.logIndex ?? 0,
      blockNumber: log.blockNumber ?? 0n,
      blockTimestamp,
      contractAddress: log.address.toLowerCase(),
      eventName: decoded?.eventName ?? "Unknown",
      loanId: loanIds[0]?.toString() ?? null,
      args: argsJson as Record<string, unknown>,
    })
    .onConflictDoNothing();

  return {
    eventName: decoded?.eventName ?? "Unknown",
    decoded: !!decoded,
    loanIds,
  };
}

function extractLoanIds(args: Record<string, unknown>): bigint[] {
  const ids: bigint[] = [];
  for (const key of ["loanId", "id", "_loanId", "loanIds"]) {
    const v = args[key];
    if (typeof v === "bigint") {
      ids.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "bigint") ids.push(item);
    }
  }
  // Deduplicate while preserving order.
  return Array.from(new Set(ids));
}
