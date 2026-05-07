import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthPill, StatePill } from "@/components/Pill";
import {
  basescanAddressUrl,
  basescanTxUrl,
  formatAmount,
  formatRelativeTime,
  healthBand,
  shortAddress,
  toHumanNumber,
  tokenInfo,
} from "@/lib/format";
import { getLoan, getLoanEvents, getOracleByDescription } from "@/lib/queries-loan";

export const dynamic = "force-dynamic";

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  const { loanId } = await params;
  const loan = await getLoan(loanId);
  if (!loan) notFound();

  const loanTok = tokenInfo(loan.loanToken);
  const collateralTok = tokenInfo(loan.collateralToken);

  const band = healthBand({
    state: loan.state,
    currentLtvBps: loan.currentLtvBps,
    liquidationLtvBps: loan.liquidationLtvBps,
    isUnderwater: loan.isUnderwater,
  });

  const events = await getLoanEvents(loanId);

  const ORACLE_BY_SYMBOL: Record<string, string> = {
    WETH: "ETH / USD",
    cbBTC: "BTC / USD",
  };
  const oracleDescription = ORACLE_BY_SYMBOL[collateralTok.symbol] ?? null;
  const oracle = oracleDescription ? await getOracleByDescription(oracleDescription) : null;
  const collateralPriceUsd = oracle ? toHumanNumber(oracle.latestAnswer, oracle.decimals) : null;
  const collateralAmountHuman = toHumanNumber(loan.collateralAmountRaw, collateralTok.decimals);
  const collateralUsdValue =
    collateralPriceUsd !== null ? collateralAmountHuman * collateralPriceUsd : null;
  const principalHuman = toHumanNumber(loan.principalRaw, loanTok.decimals);
  const accruedHuman = toHumanNumber(loan.accruedInterestRaw, loanTok.decimals);
  // True outstanding for an active loan = principal + accrued interest.
  // (Floe's `principal` field is stored at origination, not increased
  // over time — accrued lives in a separate slot.) For closed loans
  // principalRaw is 0, so outstanding is also 0.
  const outstandingDebtHuman = principalHuman + accruedHuman;
  const initialPrincipalHuman = loan.initialPrincipalRaw
    ? toHumanNumber(loan.initialPrincipalRaw, loanTok.decimals)
    : null;
  const initialCollateralHuman = loan.initialCollateralAmountRaw
    ? toHumanNumber(loan.initialCollateralAmountRaw, collateralTok.decimals)
    : null;
  const isClosed = loan.state !== "active" && loan.state !== "pending";
  const buffer =
    !isClosed && loan.currentLtvBps != null
      ? loan.liquidationLtvBps - loan.currentLtvBps
      : null;

  const startDate = loan.startTime ? new Date(Number(loan.startTime) * 1000) : null;
  const maturityUnix = loan.startTime + loan.duration;
  const maturityDate = new Date(Number(maturityUnix) * 1000);
  const now = Math.floor(Date.now() / 1000);
  const isOverdue = loan.state === "active" && BigInt(now) > maturityUnix;

  const closedAt = loan.closedAtTimestamp
    ? new Date(Number(loan.closedAtTimestamp) * 1000)
    : null;
  const heldSeconds = computeHeldSeconds(loan, isClosed, now);
  const heldDays = heldSeconds !== null ? heldSeconds / 86400 : null;
  const termDays = Number(loan.duration) / 86400;
  const termPctUsed =
    heldDays !== null && termDays > 0 ? (heldDays / termDays) * 100 : null;
  const closedHow: "early" | "on_time" | "overdue" | null = !isClosed
    ? null
    : termPctUsed === null
      ? null
      : termPctUsed < 95
        ? "early"
        : termPctUsed > 105
          ? "overdue"
          : "on_time";
  const heldDisplay = formatHeld(heldDays, termDays, termPctUsed, isClosed);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-[color:var(--muted)] hover:underline">
            ← All loans
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            Loan #{loan.loanId}{" "}
            <span className="text-[color:var(--muted)] font-normal text-base">
              · {loanTok.symbol} / {collateralTok.symbol}
            </span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <StatePill state={loan.state} />
            <HealthPill band={band} />
            {isOverdue && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
                Overdue
              </span>
            )}
            {closedHow && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  closedHow === "early"
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : closedHow === "overdue"
                      ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30"
                      : "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30"
                }`}
              >
                Closed {closedHow.replace("_", " ")}
              </span>
            )}
            {loan.operator && (
              <span className="text-[11px] text-[color:var(--muted)]">
                Facilitator-operated ·{" "}
                <a
                  href={basescanAddressUrl(loan.operator)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:underline"
                >
                  {shortAddress(loan.operator)}
                </a>
              </span>
            )}
          </div>
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
          At origination
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="Borrowed"
            value={
              initialPrincipalHuman !== null
                ? `${initialPrincipalHuman.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })} ${loanTok.symbol}`
                : "—"
            }
            sub="initial principal"
          />
          <Stat
            label="Collateral posted"
            value={
              initialCollateralHuman !== null
                ? `${initialCollateralHuman.toLocaleString(undefined, {
                    maximumFractionDigits: 8,
                  })} ${collateralTok.symbol}`
                : "—"
            }
            sub={`initial LTV ${(loan.ltvBps / 100).toFixed(2)}%`}
          />
          <Stat
            label="Interest rate"
            value={`${(loan.interestRateBps / 100).toFixed(2)}%`}
            sub={`${(termDays).toFixed(1)}-day term`}
          />
          <Stat
            label="Matched"
            value={
              loan.matchedAtBlock
                ? `block ${loan.matchedAtBlock.toString()}`
                : `block ${loan.createdAtBlock.toString()}`
            }
            sub={
              loan.matchedAtTx
                ? `tx ${loan.matchedAtTx.slice(0, 8)}…${loan.matchedAtTx.slice(-4)}`
                : "no match tx in DB"
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
          Current state
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat
            label="Outstanding debt"
            value={`${outstandingDebtHuman.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${loanTok.symbol}`}
            sub={isClosed ? "loan closed" : "principal + accrued"}
          />
          <Stat
            label="Collateral held"
            value={`${collateralAmountHuman.toLocaleString(undefined, {
              maximumFractionDigits: 8,
            })} ${collateralTok.symbol}`}
            sub={
              collateralUsdValue !== null
                ? `$${collateralUsdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : undefined
            }
          />
          <Stat
            label="Current LTV"
            value={
              isClosed
                ? "—"
                : loan.currentLtvBps != null
                  ? `${(loan.currentLtvBps / 100).toFixed(2)}%`
                  : "—"
            }
            sub={isClosed ? "n/a — loan closed" : `liq @ ${(loan.liquidationLtvBps / 100).toFixed(2)}%`}
          />
          <Stat
            label="Buffer"
            value={buffer != null ? `${(buffer / 100).toFixed(2)} pp` : "—"}
            sub={isClosed ? "n/a — loan closed" : undefined}
          />
          <Stat
            label={isClosed ? "Interest paid" : "Accrued interest"}
            value={
              isClosed
                ? loan.totalInterestPaidRaw
                  ? `${formatAmount(loan.totalInterestPaidRaw, loanTok.decimals, 6)} ${loanTok.symbol}`
                  : "—"
                : `${formatAmount(loan.accruedInterestRaw, loanTok.decimals, 6)} ${loanTok.symbol}`
            }
            sub={
              isClosed && loan.totalInterestPaidRaw && initialPrincipalHuman
                ? `${(
                    (toHumanNumber(loan.totalInterestPaidRaw, loanTok.decimals) /
                      initialPrincipalHuman) *
                    100
                  ).toFixed(2)}% of principal`
                : undefined
            }
          />
          <Stat label="State" value={loan.state} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
          <h2 className="text-sm font-medium mb-3">Counterparties</h2>
          <dl className="space-y-2 text-sm">
            <PartyRow label="Borrower" address={loan.borrower} />
            <PartyRow label="Lender" address={loan.lender} />
          </dl>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
          <h2 className="text-sm font-medium mb-3">Schedule</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Start" value={startDate?.toISOString().slice(0, 19) ?? "—"} />
            <Row label="Duration" value={`${termDays.toFixed(2)} days`} />
            <Row
              label="Maturity"
              value={maturityDate.toISOString().slice(0, 19)}
              tone={isOverdue ? "text-rose-300" : undefined}
            />
            <Row label="Grace period" value={`${(loan.gracePeriod / 86400).toFixed(2)} days`} />
            {closedAt && (
              <Row
                label="Closed"
                value={closedAt.toISOString().slice(0, 19)}
              />
            )}
            {heldDisplay && (
              <Row
                label={isClosed ? "Held for" : "Open for"}
                value={heldDisplay}
                tone={
                  closedHow === "early"
                    ? "text-emerald-300"
                    : closedHow === "overdue" || isOverdue
                      ? "text-rose-300"
                      : undefined
                }
              />
            )}
          </dl>
        </div>
      </section>

      {oracle && collateralPriceUsd !== null && (
        <section className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
          <h2 className="text-sm font-medium mb-2 flex items-baseline justify-between gap-3">
            <span>Stress simulator</span>
            <span className="text-[11px] font-normal text-[color:var(--muted)]">
              oracle ${collateralPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} ·
              updated {formatRelativeTime(oracle.updatedAt)} (block{" "}
              {oracle.observedAtBlock})
            </span>
          </h2>
          <p className="text-xs text-[color:var(--muted)] mb-4">
            What happens if {collateralTok.symbol} drops? Computed client-free from the
            most recent Chainlink {oracle.description} tick and the loan's collateral amount.
          </p>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
              <tr>
                <th className="text-left font-medium pb-2">Drop %</th>
                <th className="text-right font-medium pb-2">{collateralTok.symbol} price</th>
                <th className="text-right font-medium pb-2">Collateral value</th>
                <th className="text-right font-medium pb-2">Implied LTV</th>
                <th className="text-right font-medium pb-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {[0, 5, 10, 15, 20, 30, 50].map((dropPct) => {
                const newPrice = collateralPriceUsd * (1 - dropPct / 100);
                const newCollateralUsd = collateralAmountHuman * newPrice;
                const debtUsd = outstandingDebtHuman; // assumes USDC ≈ $1
                const newLtvBps = (debtUsd / newCollateralUsd) * 10000;
                const liquidatable = newLtvBps >= loan.liquidationLtvBps;
                return (
                  <tr key={dropPct} className="border-t border-white/5">
                    <td className="py-1.5">−{dropPct}%</td>
                    <td className="py-1.5 text-right font-mono">
                      ${newPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      ${newCollateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td
                      className={`py-1.5 text-right font-mono ${
                        liquidatable ? "text-rose-300" : ""
                      }`}
                    >
                      {newLtvBps.toFixed(2) === "Infinity" ? "—" : `${(newLtvBps / 100).toFixed(2)}%`}
                    </td>
                    <td className="py-1.5 text-right">
                      {liquidatable ? (
                        <span className="text-rose-300">⚠ liquidatable</span>
                      ) : (
                        <span className="text-emerald-300">safe</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
        <h2 className="text-sm font-medium mb-3">
          Timeline{" "}
          <span className="text-xs text-[color:var(--muted)] font-normal">
            ({events.length} events)
          </span>
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">
            No events for this loan in our DB. The indexer's backfill window may not extend back to
            this loan's creation block — bump <code>INITIAL_LOOKBACK_BLOCKS</code> or wait for the
            full backfill to finish.
          </p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => {
              const collateralRaw = e.args?.collateralAmount as string | undefined;
              const collateralLabel = collateralRaw
                ? `${formatAmount(collateralRaw, collateralTok.decimals, 6)} ${collateralTok.symbol}`
                : null;
              const eventDate = new Date(Number(e.blockTimestamp) * 1000);
              const sign = e.eventName === "LogCollateralAdded"
                ? "+"
                : e.eventName === "LogCollateralWithdrawn"
                  ? "−"
                  : null;
              return (
                <li
                  key={`${e.txHash}-${e.logIndex}`}
                  className="flex items-baseline gap-3 text-sm border-l-2 border-white/10 pl-3"
                >
                  <code className="text-xs text-[color:var(--muted)] w-44 shrink-0">
                    {eventDate.toISOString().slice(0, 19)}
                  </code>
                  <span className="font-medium">{e.eventName}</span>
                  {collateralLabel && sign && (
                    <span
                      className={`text-xs font-mono ${
                        sign === "+" ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      {sign}
                      {collateralLabel}
                    </span>
                  )}
                  <a
                    href={basescanTxUrl(e.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[color:var(--muted)] hover:underline font-mono ml-auto"
                  >
                    blk {e.blockNumber.toString()} ↗
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{label}</dt>
      <dd className="text-base font-mono mt-1">{value}</dd>
      {sub && <p className="text-[11px] text-[color:var(--muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[color:var(--muted)] text-xs">{label}</dt>
      <dd className={`font-mono text-xs ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function computeHeldSeconds(
  loan: { matchedAtTimestamp: bigint | null; closedAtTimestamp: bigint | null },
  isClosed: boolean,
  nowUnix: number,
): number | null {
  if (!loan.matchedAtTimestamp) return null;
  if (loan.closedAtTimestamp) {
    return Number(loan.closedAtTimestamp - loan.matchedAtTimestamp);
  }
  // Active loans: hold-time is "now − matched". Closed loans missing a
  // close event are unknown — return null rather than fabricate.
  return isClosed ? null : Number(BigInt(nowUnix) - loan.matchedAtTimestamp);
}

function formatHeld(
  heldDays: number | null,
  termDays: number,
  termPctUsed: number | null,
  isClosed: boolean,
): string | null {
  if (heldDays === null) return null;
  if (termPctUsed === null) return `${heldDays.toFixed(2)} days`;
  // When the term is tiny relative to held time (test loans with 5-min
  // terms held for months), the percentage gets noisy. Switch to an
  // explicit "overdue by Nd" label.
  if (isClosed && termPctUsed > 200) {
    return `${heldDays.toFixed(1)} days (${(heldDays - termDays).toFixed(1)}d past maturity)`;
  }
  return `${heldDays.toFixed(2)} days (${termPctUsed.toFixed(0)}% of term)`;
}

function PartyRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[color:var(--muted)] text-xs">{label}</dt>
      <dd>
        <a
          href={basescanAddressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs hover:underline"
        >
          {shortAddress(address)} ↗
        </a>
      </dd>
    </div>
  );
}
