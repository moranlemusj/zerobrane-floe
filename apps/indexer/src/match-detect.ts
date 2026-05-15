/**
 * Detect whether a batch of decoded events contains a new-match signal —
 * i.e. a `LogIntentsMatched` from the matcher.
 *
 * Used by the live subscriber to decide whether to kick off the
 * initial-conditions backfill (which only fills rows that just appeared).
 */

export function containsNewMatch(eventNames: ReadonlyArray<string | null | undefined>): boolean {
  return eventNames.some((n) => n === "LogIntentsMatched");
}
