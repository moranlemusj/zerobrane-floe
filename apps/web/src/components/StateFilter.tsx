"use client";

import { useRouter, useSearchParams } from "next/navigation";

const STATUSES = [
  "all",
  "healthy",
  "warning",
  "at_risk",
  "liquidatable",
  "repaid",
  "liquidated",
  "expired",
  "pending",
] as const;
type StatusValue = (typeof STATUSES)[number];

const LABEL: Record<StatusValue, string> = {
  all: "All statuses",
  healthy: "Healthy",
  warning: "Warning",
  at_risk: "At risk",
  liquidatable: "Liquidatable",
  repaid: "Repaid",
  liquidated: "Liquidated",
  expired: "Expired",
  pending: "Pending",
};

export function StateFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = (searchParams.get("status") ?? "all") as StatusValue;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as StatusValue;
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete("status");
    else next.set("status", value);
    next.delete("offset");
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  const isActive = current !== "all";
  return (
    <select
      value={current}
      onChange={onChange}
      className={`bg-white/[0.03] border border-white/10 rounded text-xs px-2 py-1 cursor-pointer hover:bg-white/[0.06] ${
        isActive ? "text-white" : "text-[color:var(--muted)]"
      }`}
      aria-label="Filter by loan status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s} className="bg-zinc-900 text-white">
          {LABEL[s]}
        </option>
      ))}
    </select>
  );
}
