import Link from "next/link";
import { StressSliders } from "@/components/StressSliders";
import {
  basescanAddressUrl,
  shortAddress,
  toHumanNumber,
  tokenInfo,
} from "@/lib/format";
import { listActiveLoansForStress, listOracles } from "@/lib/queries";
import { stressAll, type StressLoanInput } from "@/lib/stress";

export const dynamic = "force-dynamic";

function clamp(raw: string | string[] | undefined, max: number): number {
  if (typeof raw !== "string") return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > max) return max;
  return n;
}

export default async function StressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const wethDropPct = clamp(sp.weth, 50);
  const btcDropPct = clamp(sp.btc, 50);

  const [activeLoans, oracles] = await Promise.all([
    listActiveLoansForStress(),
    listOracles(),
  ]);

  const ethOracle = oracles.find((o) => o.description === "ETH / USD");
  const btcOracle = oracles.find((o) => o.description === "BTC / USD");
  const ethPriceUsd = ethOracle ? Number(ethOracle.latestAnswer) / 10 ** ethOracle.decimals : null;
  const btcPriceUsd = btcOracle ? Number(btcOracle.latestAnswer) / 10 ** btcOracle.decimals : null;

  const inputs = {
    wethDropPct,
    btcDropPct,
    oraclePrices: {
      WETH: ethPriceUsd ?? undefined,
      cbBTC: btcPriceUsd ?? undefined,
    },
  };

  const stressInputs: StressLoanInput[] = activeLoans.map((l) => {
    const accrued = l.accruedInterestRaw ? BigInt(l.accruedInterestRaw) : 0n;
    const total = (BigInt(l.principalRaw) + accrued).toString();
    return {
      loanId: l.loanId,
      loanToken: l.loanToken,
      collateralToken: l.collateralToken,
      debtRawTotal: total,
      collateralRaw: l.collateralAmountRaw,
      liquidationLtvBps: l.liquidationLtvBps,
      currentLtvBps: l.currentLtvBps,
    };
  });

  const { results, liquidatableCount, liquidatablePrincipalUsd, totalPrincipalUsd } =
    stressAll(stressInputs, inputs);

  // Currently-liquidatable baseline (no stress) — for the "0 → N" delta.
  const baselineLiquidatable = activeLoans.filter(
    (l) => l.isUnderwater === true || (l.currentLtvBps !== null && l.currentLtvBps >= l.liquidationLtvBps),
  ).length;

  const sortedResults = [...results].sort((a, b) => {
    const ax = a.stressedLtvBps ?? -1;
    const bx = b.stressedLtvBps ?? -1;
    return bx - ax;
  });
  const borrowerByLoan = new Map(activeLoans.map((l) => [l.loanId, l.borrower]));

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stress test</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          What happens to active loans if collateral drops? Math is run server-side from the
          most recent Chainlink oracle snapshot, so the URL is shareable —{" "}
          <code className="text-xs">?weth=20&amp;btc=15</code> means &quot;WETH down 20%, BTC
          down 15%.&quot;
        </p>
      </div>

      <StressSliders
        initialWethDrop={wethDropPct}
        initialBtcDrop={btcDropPct}
        ethPriceUsd={ethPriceUsd}
        btcPriceUsd={btcPriceUsd}
      />

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Active loans" value={activeLoans.length.toString()} />
        <Stat
          label="Liquidatable"
          value={`${baselineLiquidatable} → ${liquidatableCount}`}
          sub={
            wethDropPct === 0 && btcDropPct === 0 ? "no stress applied" : "under stress"
          }
          tone={liquidatableCount > baselineLiquidatable ? "rose" : undefined}
        />
        <Stat
          label="Principal at risk"
          value={`$${liquidatablePrincipalUsd.toFixed(2)}`}
          sub={`of $${totalPrincipalUsd.toFixed(2)} active`}
          tone={liquidatablePrincipalUsd > 0 ? "rose" : undefined}
        />
        <Stat
          label="Worst loan"
          value={
            sortedResults[0] && sortedResults[0].stressedLtvBps !== null
              ? `LTV ${(sortedResults[0].stressedLtvBps / 100).toFixed(2)}%`
              : "—"
          }
          sub={sortedResults[0] ? `#${sortedResults[0].loanId}` : undefined}
        />
      </section>

      {results.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-[color:var(--muted)]">
          No active loans to stress.
        </div>
      ) : (
        <section className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[color:var(--muted)] border-b border-white/10">
                <tr>
                  <Th>Loan</Th>
                  <Th>Borrower</Th>
                  <Th>Collateral</Th>
                  <Th align="right">Current LTV</Th>
                  <Th align="right">Stressed LTV</Th>
                  <Th align="right">Liq @</Th>
                  <Th align="right">Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r) => {
                  const liqLtvBps = activeLoans.find((l) => l.loanId === r.loanId)?.liquidationLtvBps ?? 0;
                  const borrower = borrowerByLoan.get(r.loanId) ?? "0x0";
                  return (
                    <tr key={r.loanId} className="border-b border-white/5">
                      <Td>
                        <Link
                          href={`/loan/${r.loanId}`}
                          className="font-mono hover:underline"
                        >
                          #{r.loanId}
                        </Link>
                      </Td>
                      <Td>
                        <Link
                          href={`/address/${borrower}`}
                          className="font-mono text-xs text-[color:var(--muted)] hover:underline"
                        >
                          {shortAddress(borrower)}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-xs">{r.collateralSymbol}</span>
                      </Td>
                      <Td align="right">
                        <span className="font-mono text-xs">
                          {r.baselineLtvBps !== null
                            ? `${(r.baselineLtvBps / 100).toFixed(2)}%`
                            : "—"}
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          className={`font-mono text-xs ${
                            r.liquidatable ? "text-rose-300 font-semibold" : ""
                          }`}
                        >
                          {r.stressedLtvBps !== null
                            ? `${(r.stressedLtvBps / 100).toFixed(2)}%`
                            : "—"}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-mono text-xs text-[color:var(--muted)]">
                          {(liqLtvBps / 100).toFixed(2)}%
                        </span>
                      </Td>
                      <Td align="right">
                        {r.liquidatable ? (
                          <span className="text-rose-300 text-xs font-medium">⚠ liquidatable</span>
                        ) : (
                          <span className="text-emerald-300 text-xs">safe</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose";
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        tone === "rose"
          ? "border-rose-500/30 bg-rose-500/[0.05]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <dt className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{label}</dt>
      <dd className={`text-base font-mono mt-1 ${tone === "rose" ? "text-rose-200" : ""}`}>
        {value}
      </dd>
      {sub && <p className="text-[11px] text-[color:var(--muted)] mt-0.5">{sub}</p>}
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

// Avoid lint complaint on unused imports kept for potential future use.
void basescanAddressUrl;
void toHumanNumber;
void tokenInfo;
