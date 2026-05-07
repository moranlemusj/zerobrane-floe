import Link from "next/link";
import { formatAmount, formatRelativeTime, tokenInfo } from "@/lib/format";
import { listMarkets, listOracles, loansByMarket } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const [markets, byMarket, oracles] = await Promise.all([
    listMarkets(),
    loansByMarket(),
    listOracles(),
  ]);

  // Merge markets table (REST-derived) with on-chain loan groupings.
  // A row may exist in only one of the two — markets we know but with
  // 0 loans, or loans we have whose market isn't in the registry.
  const byId = new Map<
    string,
    {
      marketId: string;
      registry?: typeof markets[number];
      stats?: typeof byMarket[number];
    }
  >();
  for (const m of markets) byId.set(m.marketId, { marketId: m.marketId, registry: m });
  for (const s of byMarket) {
    const existing = byId.get(s.marketId) ?? { marketId: s.marketId };
    existing.stats = s;
    byId.set(s.marketId, existing);
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => (b.stats?.active ?? 0) - (a.stats?.active ?? 0),
  );

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Lending pairs deployed on Floe's matcher contract on Base.
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {merged.map((row) => {
          const reg = row.registry;
          const loanSym = reg?.loanTokenSymbol ?? tokenInfo("?").symbol;
          const collateralSym = reg?.collateralTokenSymbol ?? tokenInfo("?").symbol;
          const loanDecimals = reg?.loanTokenDecimals ?? 6;
          const stats = row.stats;
          const inRest = !!reg;
          return (
            <Link
              key={row.marketId}
              href={`/?marketId=${row.marketId}`}
              className="rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition px-4 py-4 block"
            >
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-base font-medium">
                  {reg ? (
                    `${loanSym} / ${collateralSym}`
                  ) : (
                    <span className="text-[color:var(--muted)]">Unknown pair</span>
                  )}
                </h3>
                <span
                  className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                    inRest
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                  }`}
                  title={
                    inRest
                      ? "Listed in /v1/markets"
                      : "On-chain only — not in /v1/markets"
                  }
                >
                  {inRest ? "in REST" : "on-chain only"}
                </span>
              </div>
              <p className="font-mono text-[11px] text-[color:var(--muted)] break-all mb-3">
                {row.marketId.slice(0, 22)}…{row.marketId.slice(-8)}
              </p>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <Stat label="Active" value={stats?.active.toString() ?? "0"} />
                <Stat label="Total" value={stats?.total.toString() ?? "0"} />
                <Stat
                  label={`${loanSym} out`}
                  value={
                    stats?.outstandingPrincipalRaw
                      ? formatAmount(stats.outstandingPrincipalRaw, loanDecimals, 2)
                      : "0"
                  }
                />
              </dl>
            </Link>
          );
        })}
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
        <h2 className="text-base font-medium mb-3">Oracle prices</h2>
        {oracles.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">
            No oracle snapshots yet — run the indexer once to populate.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
              <tr>
                <th className="text-left font-medium pb-2">Feed</th>
                <th className="text-right font-medium pb-2">Latest answer</th>
                <th className="text-right font-medium pb-2">Round</th>
                <th className="text-right font-medium pb-2">Updated at</th>
              </tr>
            </thead>
            <tbody>
              {oracles.map((o) => {
                const human = Number(o.latestAnswer) / 10 ** o.decimals;
                return (
                  <tr key={o.feedAddress} className="border-t border-white/5">
                    <td className="py-2">{o.description}</td>
                    <td className="py-2 text-right font-mono">
                      ${human.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono text-[11px] text-[color:var(--muted)]">
                      {o.latestRoundId.slice(0, 14)}…
                    </td>
                    <td className="py-2 text-right text-[11px] text-[color:var(--muted)]">
                      <span className="font-mono">
                        {o.updatedAt ? formatRelativeTime(o.updatedAt) : "—"}
                      </span>{" "}
                      · block {o.observedAtBlock?.toString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase text-[color:var(--muted)]">{label}</dt>
      <dd className="font-mono text-sm mt-0.5">{value}</dd>
    </div>
  );
}
