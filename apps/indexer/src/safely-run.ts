/**
 * Wrap an async handler so a thrown exception is logged but not propagated.
 *
 * Used by the viem `watchContractEvent` `onLogs` callbacks: a transient
 * Neon `fetch failed` (or any other RPC blip) inside the body should
 * never kill the indexer process — the next event tick or 10-min
 * reconcile pass will catch up.
 */
import type pino from "pino";

export async function safelyRun(
  label: string,
  log: pino.Logger,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error(
      { err: (err as Error).message, label },
      `${label} failed — next tick / reconcile will catch up`,
    );
  }
}
