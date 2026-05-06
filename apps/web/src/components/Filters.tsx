import Link from "next/link";

interface FilterOption {
  label: string;
  href: string;
  active: boolean;
}

export function Filters({
  searchParams,
}: {
  searchParams: Record<string, string>;
}) {
  const sp = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== "") params.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    params.delete("offset");
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  const stateOptions: FilterOption[] = [
    { label: "All", href: sp({ state: undefined }), active: !searchParams.state },
    { label: "Active", href: sp({ state: "active" }), active: searchParams.state === "active" },
    { label: "Repaid", href: sp({ state: "repaid" }), active: searchParams.state === "repaid" },
    {
      label: "Liquidated",
      href: sp({ state: "liquidated" }),
      active: searchParams.state === "liquidated",
    },
  ];

  const tokenOptions: Array<{ symbol: string; address: string }> = [
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
    { symbol: "cbBTC", address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" },
  ];
  const collateralOptions: FilterOption[] = [
    { label: "All collateral", href: sp({ collateral: undefined }), active: !searchParams.collateral },
    ...tokenOptions.map((t) => ({
      label: t.symbol,
      href: sp({ collateral: t.address }),
      active: searchParams.collateral === t.address,
    })),
  ];

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
      <FilterGroup label="State" options={stateOptions} />
      <span className="hidden sm:inline text-[color:var(--muted)]">·</span>
      <FilterGroup label="Collateral" options={collateralOptions} />
    </div>
  );
}

function FilterGroup({ label, options }: { label: string; options: FilterOption[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-[color:var(--muted)] mr-1">{label}:</span>
      {options.map((o) => (
        <Link
          key={o.label}
          href={o.href}
          className={`px-2 py-1 rounded text-xs ${
            o.active
              ? "bg-white/10 text-white ring-1 ring-white/20"
              : "text-[color:var(--muted)] hover:text-white hover:bg-white/[0.03]"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
