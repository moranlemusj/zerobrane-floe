import { formatRelativeTime } from "@/lib/format";

interface OracleRow {
  feedAddress: string;
  description: string;
  decimals: number;
  latestAnswer: string;
  updatedAt: Date | string;
  observedAtBlock: bigint;
}

export function OracleStrip({ oracles }: { oracles: OracleRow[] }) {
  if (oracles.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
      <span className="uppercase tracking-wide text-[10px] text-[color:var(--muted)]">
        Oracles
      </span>
      {oracles.map((o) => {
        const priceUsd = Number(o.latestAnswer) / 10 ** o.decimals;
        return (
          <span key={o.feedAddress} className="flex items-baseline gap-1.5 font-mono">
            <span className="text-[color:var(--muted)]">{o.description}</span>
            <span>
              ${priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-[color:var(--muted)]">
              · {formatRelativeTime(o.updatedAt)} · blk {o.observedAtBlock.toString()}
            </span>
          </span>
        );
      })}
    </div>
  );
}
