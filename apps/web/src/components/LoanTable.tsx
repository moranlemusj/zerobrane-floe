import Link from "next/link";
import {
  basescanAddressUrl,
  formatAmount,
  healthBand,
  shortAddress,
  tokenInfo,
} from "@/lib/format";
import type { LoanRow } from "@/lib/queries";
import { HealthPill, StatePill } from "./Pill";

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
    if ((searchParams.sort ?? "currentLtv") !== col) return "";
    return (searchParams.dir ?? "desc") === "asc" ? "▲" : "▼";
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
              <Th>
                <Link href={sortLink("loanId")} className="hover:text-white">
                  ID {sortIcon("loanId")}
                </Link>
              </Th>
              <Th>State</Th>
              <Th>Health</Th>
              <Th>Market</Th>
              <Th>Borrower</Th>
              <Th align="right">
                <Link href={sortLink("principal")} className="hover:text-white">
                  Principal {sortIcon("principal")}
                </Link>
              </Th>
              <Th align="right">
                <Link href={sortLink("currentLtv")} className="hover:text-white">
                  LTV {sortIcon("currentLtv")}
                </Link>
              </Th>
              <Th align="right">Buffer</Th>
              <Th align="right">Rate</Th>
              <Th align="right">Operator</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[color:var(--muted)]">
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
                const buffer =
                  loan.currentLtvBps != null
                    ? loan.liquidationLtvBps - loan.currentLtvBps
                    : null;
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
                      <StatePill state={loan.state} />
                    </Td>
                    <Td>
                      <HealthPill band={band} />
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
                      <span className="font-mono text-xs">
                        {formatAmount(loan.principalRaw, loanTok.decimals, 2)}{" "}
                        <span className="text-[color:var(--muted)]">{loanTok.symbol}</span>
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {loan.currentLtvBps != null
                          ? `${(loan.currentLtvBps / 100).toFixed(2)}%`
                          : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {buffer != null ? `${(buffer / 100).toFixed(2)} pp` : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs">
                        {(loan.interestRateBps / 100).toFixed(2)}%
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-xs text-[color:var(--muted)]">
                        {loan.operator ? shortAddress(loan.operator) : "—"}
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
