"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function EventTypeFilter({ options }: { options: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("event") ?? "all";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(searchParams.toString());
    if (e.target.value === "all") next.delete("event");
    else next.set("event", e.target.value);
    next.delete("offset");
    const qs = next.toString();
    router.push(qs ? `/activity?${qs}` : "/activity");
  }

  const isActive = current !== "all";
  return (
    <select
      value={current}
      onChange={onChange}
      className={`bg-white/[0.03] border border-white/10 rounded text-xs px-2 py-1 cursor-pointer hover:bg-white/[0.06] ${
        isActive ? "text-white" : "text-[color:var(--muted)]"
      }`}
      aria-label="Filter events by type"
    >
      <option value="all" className="bg-zinc-900 text-white">
        All events
      </option>
      {options.map((name) => (
        <option key={name} value={name} className="bg-zinc-900 text-white">
          {name}
        </option>
      ))}
    </select>
  );
}
