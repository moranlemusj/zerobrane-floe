/**
 * Backfill loan-lifecycle columns by reading derivable data we already
 * have but haven't projected onto the loans row.
 *
 *   1. Initial conditions — Floe's matcher events emit hashes, not
 *      amounts. The actual matched principal and committed collateral
 *      are visible only as ERC-20 Transfer logs in the same tx, so we
 *      pull the receipt and walk its logs.
 *
 *   2. Close timestamps — there's no explicit "loan repaid" event; we
 *      treat the timestamp of the last lifecycle event for a closed
 *      loan as its close time.
 */

import { eq, isNull, sql } from "drizzle-orm";
import { type Hex, getAddress, type TransactionReceipt } from "viem";
import { type Db, loans } from "@floe-dashboard/data";
import type { IndexerClients } from "./clients";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

const MATCH_EVENT_NAME = "LogIntentsMatched" as const;
const RECEIPT_CHUNK = Number(process.env.RECEIPT_CHUNK ?? 5);
const RECEIPT_CHUNK_THROTTLE_MS = Number(process.env.RECEIPT_CHUNK_THROTTLE_MS ?? 200);

type MatchEvent = {
  loan_id: string;
  tx_hash: string;
  block_number: bigint;
  block_timestamp: bigint;
  [k: string]: unknown;
};

interface BackfillLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: BackfillLogger = { warn() {} };

export async function backfillInitialConditions(
  clients: IndexerClients,
  log: BackfillLogger = noopLogger,
): Promise<{ updated: number; skipped: number; missing: number }> {
  const targets = await clients.db
    .select({
      loanId: loans.loanId,
      borrower: loans.borrower,
      lender: loans.lender,
      loanToken: loans.loanToken,
      collateralToken: loans.collateralToken,
    })
    .from(loans)
    .where(isNull(loans.initialPrincipalRaw));

  if (targets.length === 0) return { updated: 0, skipped: 0, missing: 0 };

  const targetIds = targets.map((t) => t.loanId);
  const idList = sql.join(
    targetIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const matches = await clients.db.execute<MatchEvent>(sql`
    SELECT DISTINCT ON (loan_id) loan_id, tx_hash, block_number, block_timestamp
    FROM events
    WHERE event_name = ${MATCH_EVENT_NAME} AND loan_id IN (${idList})
    ORDER BY loan_id, block_number ASC
  `);
  const matchByLoan = new Map<string, MatchEvent>();
  for (const m of matches.rows) matchByLoan.set(m.loan_id, m);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  // Dedupe in-flight receipt fetches: matcher can match multiple loans
  // in the same tx (matchPair loop).
  const receiptInFlight = new Map<string, Promise<TransactionReceipt | null>>();

  for (let i = 0; i < targets.length; i += RECEIPT_CHUNK) {
    const chunk = targets.slice(i, i + RECEIPT_CHUNK);
    const results = await Promise.all(
      chunk.map(async (t) => {
        const match = matchByLoan.get(t.loanId);
        if (!match) return { ok: "missing" as const };
        const txHash = match.tx_hash as Hex;
        let receiptPromise = receiptInFlight.get(txHash);
        if (!receiptPromise) {
          receiptPromise = clients.httpClient
            .getTransactionReceipt({ hash: txHash })
            .catch((err: Error) => {
              log.warn({ txHash, err: err.message }, "receipt fetch failed");
              return null;
            });
          receiptInFlight.set(txHash, receiptPromise);
        }
        const receipt = await receiptPromise;
        if (!receipt) return { ok: "skip" as const };
        const amounts = extractAmounts(receipt, t);
        if (!amounts) {
          log.warn(
            { loanId: t.loanId, txHash },
            "no transfer events matched borrower for principal/collateral",
          );
          return { ok: "skip" as const };
        }
        return { ok: "ready" as const, t, match, txHash, ...amounts };
      }),
    );
    const writes: Array<Promise<unknown>> = [];
    for (const r of results) {
      if (r.ok === "missing") {
        missing++;
        continue;
      }
      if (r.ok === "skip") {
        skipped++;
        continue;
      }
      writes.push(
        clients.db
          .update(loans)
          .set({
            initialPrincipalRaw: r.principal.toString(),
            initialCollateralAmountRaw: r.collateral.toString(),
            matchedAtBlock: r.match.block_number,
            matchedAtTimestamp: r.match.block_timestamp,
            matchedAtTx: r.txHash,
            updatedAt: new Date(),
          })
          .where(eq(loans.loanId, r.t.loanId)),
      );
    }
    await Promise.all(writes);
    updated += writes.length;
    if (i + RECEIPT_CHUNK < targets.length) {
      await new Promise((res) => setTimeout(res, RECEIPT_CHUNK_THROTTLE_MS));
    }
  }

  return { updated, skipped, missing };
}

interface LoanTokens {
  borrower: string;
  lender: string;
  loanToken: string;
  collateralToken: string;
}

function extractAmounts(
  receipt: TransactionReceipt,
  t: LoanTokens,
): { principal: bigint; collateral: bigint } | null {
  const borrowerAddr = getAddress(t.borrower);
  const lenderAddr = getAddress(t.lender);
  const loanTokenAddr = getAddress(t.loanToken);
  const collateralTokenAddr = getAddress(t.collateralToken);
  // Matched principal = lender's total loanToken commitment in the
  // match-tx. Equals the borrower's debt — the matcher commission gets
  // routed out separately (lender → matcher), so we sum ALL outgoing
  // loanToken transfers from the lender. Using "to === borrower" was
  // wrong: that captures the post-commission disbursement, not the debt.
  let principal = 0n;
  let collateral: bigint | null = null;
  for (const lg of receipt.logs) {
    if (lg.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (lg.topics.length < 3) continue;
    const from = topicToAddress(lg.topics[1]);
    const tokenAddr = getAddress(lg.address);
    const value = BigInt(lg.data);
    if (tokenAddr === loanTokenAddr && from === lenderAddr) {
      principal += value;
    }
    if (
      collateral === null &&
      tokenAddr === collateralTokenAddr &&
      from === borrowerAddr
    ) {
      collateral = value;
    }
  }
  if (principal === 0n || collateral === null) return null;
  return { principal, collateral };
}

function topicToAddress(topic: `0x${string}` | undefined): `0x${string}` {
  if (!topic) return "0x0000000000000000000000000000000000000000";
  return getAddress(`0x${topic.slice(-40)}`);
}

/**
 * The matcher emits two close-snapshot variants, neither named in the
 * ABIs Sourcify gave us. Both carry the loan ID in topic[1] and the
 * total repaid amount (initial principal + interest) in data field[0].
 *   - 0x41b29a… : 4-field "with collateral detail" snapshot
 *   - 0xcf505d4b… : 3-field "lean" snapshot
 * Both validate: total_repaid - initial_principal = interest paid, and
 * for 0x41b29a we've cross-checked against actual Transfer receipts.
 */
const LOAN_CLOSE_TOPICS = [
  "0x41b29a045f87e126b8fc2763fc667b7c5fb62c0ac59043b44b389a9fd94206df",
  "0xcf505d4ba731f4c3797c7de9790d59ae17a26e0cba0059717b2a318242b7fb0a",
] as const;

interface CloseSnapshot {
  loan_id: string;
  block_number: bigint;
  block_timestamp: bigint;
  tx_hash: string;
  args: { data?: string; topics?: string[] };
}

/**
 * Backfill close metadata for loans in a closed state. Reads the
 * matcher's close-snapshot event (currently emitted as Unknown) when
 * present — it gives us authoritative close block, repayment amount,
 * and collateral returned. Falls back to "last non-match event" when
 * the snapshot isn't in our DB.
 */
export async function backfillCloseTimestamps(
  db: Db,
): Promise<{ updated: number; fromSnapshot: number; fromFallback: number; skipped: number }> {
  const targets = await db.execute<{
    loan_id: string;
    initial_principal_raw: string | null;
  }>(sql`
    SELECT loan_id, initial_principal_raw::text AS initial_principal_raw FROM loans
    WHERE state IN ('repaid', 'liquidated', 'expired')
      AND (closed_at_block IS NULL OR total_interest_paid_raw IS NULL)
  `);
  if (targets.rows.length === 0) {
    return { updated: 0, fromSnapshot: 0, fromFallback: 0, skipped: 0 };
  }

  const initialByLoan = new Map<string, bigint | null>();
  for (const t of targets.rows) {
    initialByLoan.set(
      t.loan_id,
      t.initial_principal_raw ? BigInt(t.initial_principal_raw) : null,
    );
  }
  const ids = targets.rows.map((t) => t.loan_id);
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

  // Prefer the close-snapshot event (Unknown name, has amounts). Two
  // topic variants — pull both, decode loan ID in JS, filter to targets.
  const closeTopicList = sql.join(
    LOAN_CLOSE_TOPICS.map((t) => sql`${t}`),
    sql`, `,
  );
  const snapshotsRaw = await db.execute<{
    block_number: bigint;
    block_timestamp: bigint;
    tx_hash: string;
    log_index: number;
    args: { data?: string; topics?: string[] };
  }>(sql`
    SELECT block_number, block_timestamp, tx_hash, log_index, args
    FROM events
    WHERE event_name = 'Unknown'
      AND args->'topics'->>0 IN (${closeTopicList})
    ORDER BY block_number DESC, log_index DESC
  `);
  const targetIdSet = new Set(ids);
  const snapshotByLoan = new Map<string, CloseSnapshot>();
  for (const r of snapshotsRaw.rows) {
    const topic1 = r.args?.topics?.[1];
    if (!topic1) continue;
    const loanId = BigInt(topic1).toString();
    if (!targetIdSet.has(loanId) || snapshotByLoan.has(loanId)) continue;
    snapshotByLoan.set(loanId, {
      loan_id: loanId,
      block_number: r.block_number,
      block_timestamp: r.block_timestamp,
      tx_hash: r.tx_hash,
      args: r.args,
    });
  }
  const snapshots = { rows: Array.from(snapshotByLoan.values()) };

  // Fallback: last non-match event for loans without a snapshot.
  const fallbacks = await db.execute<{
    loan_id: string;
    block_number: bigint;
    block_timestamp: bigint;
    tx_hash: string;
  }>(sql`
    SELECT DISTINCT ON (loan_id) loan_id, block_number, block_timestamp, tx_hash
    FROM events
    WHERE loan_id IN (${idList})
      AND event_name NOT IN ('LogIntentsMatched', 'LogIntentsMatchedDetailed', 'BorrowIntentFilled')
    ORDER BY loan_id, block_number DESC, log_index DESC
  `);
  const fallbackByLoan = new Map<string, (typeof fallbacks.rows)[number]>();
  for (const r of fallbacks.rows) fallbackByLoan.set(r.loan_id, r);

  let fromSnapshot = 0;
  let fromFallback = 0;
  const writes: Array<Promise<unknown>> = [];
  const handled = new Set<string>();

  for (const s of snapshots.rows) {
    handled.add(s.loan_id);
    const totalRepaid = parseUint256Field(s.args?.data, 0);
    const initial = initialByLoan.get(s.loan_id);
    const interestPaid =
      totalRepaid !== null && initial !== null && initial !== undefined
        ? totalRepaid > initial
          ? totalRepaid - initial
          : 0n
        : null;
    writes.push(
      db
        .update(loans)
        .set({
          closedAtBlock: s.block_number,
          closedAtTimestamp: s.block_timestamp,
          closedAtTx: s.tx_hash,
          totalInterestPaidRaw: interestPaid !== null ? interestPaid.toString() : null,
          updatedAt: new Date(),
        })
        .where(eq(loans.loanId, s.loan_id)),
    );
    fromSnapshot++;
  }
  for (const r of fallbacks.rows) {
    if (handled.has(r.loan_id)) continue;
    writes.push(
      db
        .update(loans)
        .set({
          closedAtBlock: r.block_number,
          closedAtTimestamp: r.block_timestamp,
          closedAtTx: r.tx_hash,
          updatedAt: new Date(),
        })
        .where(eq(loans.loanId, r.loan_id)),
    );
    fromFallback++;
    handled.add(r.loan_id);
  }
  await Promise.all(writes);
  const skipped = ids.length - handled.size;
  return { updated: handled.size, fromSnapshot, fromFallback, skipped };
}

/** Read a uint256 field at `index` (0-based) from a hex-encoded log data string. */
function parseUint256Field(data: string | undefined, index: number): bigint | null {
  if (!data || !data.startsWith("0x")) return null;
  const hex = data.slice(2);
  const start = index * 64;
  if (hex.length < start + 64) return null;
  return BigInt("0x" + hex.slice(start, start + 64));
}

