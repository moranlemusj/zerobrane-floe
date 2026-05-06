import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthPill, StatePill } from "@/components/Pill";
import {
  basescanAddressUrl,
  basescanTxUrl,
  formatAmount,
  healthBand,
  shortAddress,
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

  // Pick the oracle for this loan's collateral asset for the stress simulator.
  const oracleDescription =
    collateralTok.symbol === "WETH"
      ? "ETH / USD"
      : collateralTok.symbol === "cbBTC"
        ? "BTC / USD"
        : null;
  const oracle = oracleDescription ? await getOracleByDescription(oracleDescription) : null;
  const collateralPriceUsd = oracle
    ? Number(oracle.latestAnswer) / 10 ** oracle.decimals
    : null;
  const collateralAmountHuman = Number(loan.collateralAmountRaw) / 10 ** collateralTok.decimals;
  const collateralUsdValue =
    collateralPriceUsd !== null ? collateralAmountHuman * collateralPriceUsd : null;
  const principalHuman = Number(loan.principalRaw) / 10 ** loanTok.decimals;
  const buffer =
    loan.currentLtvBps != null ? loan.liquidationLtvBps - loan.currentLtvBps : null;

  const startDate = loan.startTime ? new Date(Number(loan.startTime) * 1000) : null;
  const maturityUnix = loan.startTime + loan.duration;
  const maturityDate = new Date(Number(maturityUnix) * 1000);
  const now = Math.floor(Date.now() / 1000);
  const isOverdue = loan.state === "active" && BigInt(now) > maturityUnix;

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

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Principal" value={`${principalHuman} ${loanTok.symbol}`} />
        <Stat
          label="Collateral"
          value={`${collateralAmountHuman.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })} ${collateralTok.symbol}`}
          sub={
            collateralUsdValue !== null
              ? `$${collateralUsdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : undefined
          }
        />
        <Stat
          label="Current LTV"
          value={loan.currentLtvBps != null ? `${(loan.currentLtvBps / 100).toFixed(2)}%` : "—"}
          sub={`liq @ ${(loan.liquidationLtvBps / 100).toFixed(2)}%`}
        />
        <Stat
          label="Buffer"
          value={buffer != null ? `${(buffer / 100).toFixed(2)} pp` : "—"}
        />
        <Stat label="Interest rate" value={`${(loan.interestRateBps / 100).toFixed(2)}%`} />
        <Stat
          label="Accrued interest"
          value={`${formatAmount(loan.accruedInterestRaw, loanTok.decimals, 6)} ${loanTok.symbol}`}
        />
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
            <Row label="Duration" value={`${(Number(loan.duration) / 86400).toFixed(2)} days`} />
            <Row
              label="Maturity"
              value={maturityDate.toISOString().slice(0, 19)}
              tone={isOverdue ? "text-rose-300" : undefined}
            />
            <Row label="Grace period" value={`${(loan.gracePeriod / 86400).toFixed(2)} days`} />
          </dl>
        </div>
      </section>

      {oracle && collateralPriceUsd !== null && (
        <section className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
          <h2 className="text-sm font-medium mb-3">Stress simulator</h2>
          <p className="text-xs text-[color:var(--muted)] mb-4">
            What happens if {collateralTok.symbol} drops? Computed client-free from current oracle ($
            {collateralPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}) and the
            loan's collateral amount.
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
                const debtUsd = principalHuman; // assumes USDC ≈ $1
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
            {events.map((e) => (
              <li
                key={`${e.txHash}-${e.logIndex}`}
                className="flex items-baseline gap-3 text-sm border-l-2 border-white/10 pl-3"
              >
                <code className="text-xs text-[color:var(--muted)] w-32 shrink-0">
                  blk {e.blockNumber.toString()}
                </code>
                <span className="font-medium">{e.eventName}</span>
                <a
                  href={basescanTxUrl(e.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[color:var(--muted)] hover:underline font-mono ml-auto"
                >
                  {e.txHash.slice(0, 10)}…{e.txHash.slice(-6)} ↗
                </a>
              </li>
            ))}
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
