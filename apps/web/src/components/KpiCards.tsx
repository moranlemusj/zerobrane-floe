import { formatAmount, formatRelativeTime } from "@/lib/format";
import type { KpiSummary } from "@/lib/queries";

export function KpiCards({ kpis }: { kpis: KpiSummary }) {
  // Active principal is in USDC (6 decimals) for the markets we have.
  const usdcOut = formatAmount(kpis.totalPrincipalActiveRaw, 6, 2);
  const cards: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    { label: "Active loans", value: kpis.activeLoans.toString(), sub: `${kpis.totalLoans} total ever` },
    { label: "USDC outstanding", value: usdcOut, sub: "across active loans" },
    { label: "Repaid", value: kpis.repaidLoans.toString() },
    {
      label: "At risk",
      value: kpis.underwaterLoans.toString(),
      sub: "underwater right now",
      tone: kpis.underwaterLoans > 0 ? "text-rose-300" : undefined,
    },
    { label: "Markets", value: kpis.marketCount.toString(), sub: "from /v1/markets" },
    {
      label: "Indexer @ block",
      value: kpis.lastBlock ?? "—",
      sub: kpis.lastReconciledAt
        ? `synced ${formatRelativeTime(kpis.lastReconciledAt)}`
        : "Base mainnet",
    },
  ];
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3"
        >
          <dt className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{c.label}</dt>
          <dd className={`text-xl font-mono mt-1 ${c.tone ?? ""}`}>{c.value}</dd>
          {c.sub && <p className="text-[11px] text-[color:var(--muted)] mt-0.5">{c.sub}</p>}
        </div>
      ))}
    </dl>
  );
}
