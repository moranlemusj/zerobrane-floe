import Link from "next/link";
import { EventTypeFilter } from "@/components/EventTypeFilter";
import {
  basescanTxUrl,
  formatAmount,
  formatRelativeTime,
  tokenInfo,
} from "@/lib/format";
import { type EventRow, listEventNames, listEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Display tone per event family — green for positive lifecycle, amber for
// neutral state changes, rose for revoke/withdraw, zinc for misc.
const EVENT_TONES: Record<string, string> = {
  LogIntentsMatched: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  LogIntentsMatchedDetailed: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  BorrowIntentFilled: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  LendIntentFullyFilled: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  LogCollateralAdded: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30",
  LogCollateralWithdrawn: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  LogIntentRevoked: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
  LogBorrowerOfferPosted: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30",
  LogLenderOfferPosted: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30",
  OperatorSet: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30",
};
function eventTone(name: string): string {
  return EVENT_TONES[name] ?? "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const eventName = typeof sp.event === "string" ? sp.event : undefined;
  const offset = Math.max(0, Number(sp.offset ?? 0)) || 0;

  const [{ rows, total }, names] = await Promise.all([
    listEvents({ eventName, limit: PAGE_SIZE, offset }),
    listEventNames(),
  ]);

  const start = offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (eventName) params.set("event", eventName);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    const s = params.toString();
    return s ? `/activity?${s}` : "/activity";
  };

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Reverse-chronological stream of every matcher event we've indexed.
        </p>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
          Filter:
        </span>
        <EventTypeFilter options={names} />
        <span className="ml-auto text-xs text-[color:var(--muted)]">
          {total === 0 ? "No events" : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-[color:var(--muted)]">
          No events match this filter.
        </div>
      ) : (
        <ol className="divide-y divide-white/5 rounded-lg border border-white/10 bg-white/[0.02]">
          {rows.map((e) => (
            <li
              key={`${e.txHash}-${e.logIndex}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
            >
              <time
                dateTime={new Date(Number(e.blockTimestamp) * 1000).toISOString()}
                title={new Date(Number(e.blockTimestamp) * 1000).toISOString()}
                className="font-mono text-xs text-[color:var(--muted)] w-20 shrink-0"
              >
                {formatRelativeTime(new Date(Number(e.blockTimestamp) * 1000))}
              </time>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${eventTone(
                  e.eventName,
                )}`}
              >
                {e.eventName}
              </span>
              <EventDetail event={e} />
              <a
                href={basescanTxUrl(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[11px] text-[color:var(--muted)] hover:text-white font-mono"
              >
                blk {e.blockNumber.toString()} ↗
              </a>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between text-sm">
        {offset > 0 ? (
          <Link
            href={buildHref({ offset: String(Math.max(0, offset - PAGE_SIZE)) })}
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/[0.03]"
          >
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {end < total && (
          <Link
            href={buildHref({ offset: String(offset + PAGE_SIZE) })}
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/[0.03]"
          >
            Older →
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * Per-event-type renderer — extracts the most informative arg into
 * inline text. For collateral add/withdraw we'd ideally know which
 * token is involved (that lives on the loan, not the event), so we
 * fall back to "raw amount" without a unit. The link to the loan
 * detail page lets the user click through for context.
 */
function EventDetail({ event }: { event: EventRow }) {
  const collateralAmount = event.args?.collateralAmount;
  const loanLink = event.loanId ? (
    <Link href={`/loan/${event.loanId}`} className="font-mono text-xs hover:underline">
      #{event.loanId}
    </Link>
  ) : null;

  if (
    typeof collateralAmount === "string" &&
    (event.eventName === "LogCollateralAdded" || event.eventName === "LogCollateralWithdrawn")
  ) {
    const sign = event.eventName === "LogCollateralAdded" ? "+" : "−";
    const tone = sign === "+" ? "text-emerald-300" : "text-amber-300";
    return (
      <span className="flex items-baseline gap-2">
        {loanLink}
        <span className={`text-xs font-mono ${tone}`}>
          {sign}
          {formatAmount(collateralAmount, 18, 6)} (collateral, raw)
        </span>
      </span>
    );
  }

  if (loanLink) return loanLink;
  return <span className="text-[11px] text-[color:var(--muted)]">no loan</span>;
}

// Avoid lint complaint on unused tokenInfo (kept available for a follow-up
// that resolves collateral decimals via loan join).
void tokenInfo;
