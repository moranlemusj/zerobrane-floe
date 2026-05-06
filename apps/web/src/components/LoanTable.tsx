import Link from "next/link";
import {
  basescanAddressUrl,
  formatAmount,
  healthBand,
  shortAddress,
  tokenInfo,
} from "@/lib/format";
import type { LoanRow } from "@/lib/queries";
import { StatusPill } from "./Pill";

export function LoanTable({
  rows,
  total,
  offset,
  limit,
  searchParams,
}: {
  rows: LoanRow[];
  total: number;
  offset: number;
  limit: number;
  searchParams: Record<string, string>;
}) {
  const baseLink = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== "") params.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  const sortLink = (col: string) => {
    const isActive = (searchParams.sort ?? "currentLtv") === col;
    const nextDir =
      isActive && (searchParams.dir ?? "desc") === "desc" ? "asc" : "desc";
    return baseLink({ sort: col, dir: nextDir, offset: 0 });
  };

  const sortIcon = (col: string) => {
    const active = (searchParams.sort ?? "currentLtv") === col;
    if (!active) return <span className="text-white/30">↕</span>;
    return (searchParams.dir ?? "desc") === "asc" ? "▲" : "▼";
  };

  const SortableTh = ({
    col,
    align = "right",
    children,
  }: {
    col: string;
    align?: "left" | "right";
    children: React.ReactNode;
  }) => {
    const active = (searchParams.sort ?? "currentLtv") === col;
    return (
      <Th align={align}>
        <Link
          href={sortLink(col)}
          className={`underline decoration-dotted decoration-white/20 underline-offset-4 hover:decoration-white/60 hover:text-white ${
            active ? "text-white" : ""
          }`}
        >
          {children} {sortIcon(col)}
        </Link>
      </Th>
    );
  };

  const start = offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/10 text-sm">
        <div className="text-[color:var(--muted)]">
          {total === 0 ? "No loans match" : `${start}–${end} of ${total} loans`}
        </div>
        <div className="flex items-center gap-2">
          {offset > 0 && (
            <Link
              href={baseLink({ offset: Math.max(0, offset - limit) })}
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/[0.03]"
            >
              ← Prev
            </Link>
          )}
          {end < total && (
            <Link
              href={baseLink({ offset: offset + limit })}
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/[0.03]"
            >
              Next →
            </Link>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-[color:var(--muted)] border-b border-white/10">
            <tr>
              <SortableTh col="loanId" align="left">ID</SortableTh>
              <SortableTh col="status" align="left">Status</SortableTh>
              <Th>Market</Th>
              <Th>Borrower</Th>
              <SortableTh col="principal">Borrowed</SortableTh>
              <Th align="right">Collateral</Th>
              <SortableTh col="interestPaid">Interest</SortableTh>
              <SortableTh col="initialLtv">Init LTV</SortableTh>
              <SortableTh col="currentLtv">Cur LTV</SortableTh>
              <SortableTh col="interestRate">Rate</SortableTh>
              <SortableTh col="matchedAt">Matched</SortableTh>
              <SortableTh col="heldDuration">Held</SortableTh>
              <SortableTh col="closedAt">Closed</SortableTh>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-[color:var(--muted)]">
                  No loans match these filters.
                </td>
              </tr>
            ) : (
              rows.map((loan) => {
                const loanTok = tokenInfo(loan.loanToken);
                const collateralTok = tokenInfo(loan.collateralToken);
                const band = healthBand({
                  state: loan.state,
                  currentLtvBps: loan.currentLtvBps,
                  liquidationLtvBps: loan.liquidationLtvBps,
                  isUnderwater: loan.isUnderwater,
                });
                const heldDays = computeHeldDays(loan);
                return (
                  <tr
                    key={loan.loanId}
                    className="border-b border-white/5 hover:bg-white/[0.02]"
                  >
                    <Td>
                      <Link
                        href={`/loan/${loan.loanId}`}
                        className="font-mono hover:underline"
                      >
                        #{loan.loanId}
                      </Link>
                    </Td>
                    <Td>
                      <StatusPill state={loan.state} band={band} />
                    </Td>
                    <Td>
                      <span className="text-xs">
                        {loanTok.symbol}/{collateralTok.symbol}
                      </span>
                    </Td>
                    <Td>
                      <a
                        href={basescanAddressUrl(loan.borrower)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs hover:underline text-[color:var(--muted)]"
                      >
                        {shortAddress(loan.borrower)}
                      </a>
                    </Td>
                    <Td align="right">
                      <PrincipalCell loan={loan} />
                    </Td>
                    <Td align="right">
                      <CollateralCell loan={loan} />
                    </Td>
                    <Td align="right">
                      <InterestCell loan={loan} />
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {(loan.ltvBps / 100).toFixed(2)}%
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {isClosedState(loan.state)
                          ? "—"
                          : loan.currentLtvBps != null
                            ? `${(loan.currentLtvBps / 100).toFixed(2)}%`
                            : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {(loan.interestRateBps / 100).toFixed(2)}%
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-[11px] text-[color:var(--muted)]">
                        {fmtDate(loan.matchedAtTimestamp)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs text-[color:var(--muted)]">
                        {heldDays !== null ? `${heldDays.toFixed(1)}d` : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-[11px] text-[color:var(--muted)]">
                        {fmtDate(loan.closedAtTimestamp)}
                      </span>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function computeHeldDays(loan: LoanRow): number | null {
  if (!loan.matchedAtTimestamp) return null;
  if (loan.closedAtTimestamp) {
    return Number(loan.closedAtTimestamp - loan.matchedAtTimestamp) / 86400;
  }
  if (isClosedState(loan.state)) return null;
  return Number(BigInt(Math.floor(Date.now() / 1000)) - loan.matchedAtTimestamp) / 86400;
}

function isClosedState(state: string): boolean {
  return state === "repaid" || state === "liquidated" || state === "expired";
}

function fmtDate(ts: bigint | null): string {
  if (!ts) return "—";
  return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
}

function PrincipalCell({ loan }: { loan: LoanRow }) {
  const { symbol, decimals } = tokenInfo(loan.loanToken);
  const initial = loan.initialPrincipalRaw;
  const current = loan.principalRaw;
  if (!initial) {
    return (
      <span className="font-mono text-xs">
        {formatAmount(current, decimals, 2)}{" "}
        <span className="text-[color:var(--muted)]">{symbol}</span>
      </span>
    );
  }
  return (
    <span className="font-mono text-xs">
      {formatAmount(initial, decimals, 2)}{" "}
      <span className="text-[color:var(--muted)]">{symbol}</span>
    </span>
  );
}

function CollateralCell({ loan }: { loan: LoanRow }) {
  const { symbol, decimals } = tokenInfo(loan.collateralToken);
  const value = loan.initialCollateralAmountRaw ?? loan.collateralAmountRaw;
  return (
    <span className="font-mono text-xs">
      {formatAmount(value, decimals, 4)}{" "}
      <span className="text-[color:var(--muted)]">{symbol}</span>
    </span>
  );
}

function InterestCell({ loan }: { loan: LoanRow }) {
  const { symbol, decimals } = tokenInfo(loan.loanToken);
  // Closed loans: total paid, from the matcher's close-snapshot event.
  // Active loans: accruedInterestRaw, hydrated from getAccruedInterest()
  // — Floe's principal field stays at the original amount, so deriving
  // accrued from (principal − initial) would always be 0.
  if (isClosedState(loan.state)) {
    if (!loan.totalInterestPaidRaw) {
      return <span className="font-mono text-xs text-[color:var(--muted)]">—</span>;
    }
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-mono text-xs">
          {formatAmount(loan.totalInterestPaidRaw, decimals, 4)}{" "}
          <span className="text-[color:var(--muted)]">{symbol}</span>
        </span>
        <span className="text-[10px] text-[color:var(--muted)]">paid</span>
      </div>
    );
  }
  const accrued = loan.accruedInterestRaw;
  if (!accrued || BigInt(accrued) <= 0n) {
    return <span className="font-mono text-xs text-[color:var(--muted)]">0</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-xs text-emerald-300/80">
        +{formatAmount(accrued, decimals, 4)}{" "}
        <span className="text-[color:var(--muted)]">{symbol}</span>
      </span>
      <span className="text-[10px] text-[color:var(--muted)]">accruing</span>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${
        align === "right" ? "text-right" : "text-left"
      } whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} whitespace-nowrap`}
    >
      {children}
    </td>
  );
}
