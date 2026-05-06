import { type HealthBand, HEALTH_CLASS, HEALTH_LABEL } from "@/lib/format";

export function HealthPill({ band }: { band: HealthBand }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${HEALTH_CLASS[band]}`}
    >
      {HEALTH_LABEL[band]}
    </span>
  );
}

/**
 * Single-pill status indicator. For active loans → shows the health
 * band (Healthy/Warning/At risk/Liquidatable). For closed loans → shows
 * the lifecycle outcome (Repaid/Liquidated/Expired). Avoids the
 * State+Health redundancy where every closed loan said "repaid · Closed".
 */
export function StatusPill({ state, band }: { state: string; band: HealthBand }) {
  if (state === "active" || state === "pending") {
    return <HealthPill band={band} />;
  }
  return <StatePill state={state} />;
}

export function StatePill({ state }: { state: string }) {
  const stateClasses: Record<string, string> = {
    active: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30",
    pending: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30",
    repaid: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    liquidated: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
    expired: "bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        stateClasses[state] ?? "bg-zinc-500/15 text-zinc-300"
      }`}
    >
      {state}
    </span>
  );
}
