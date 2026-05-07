"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

interface Props {
  initialWethDrop: number;
  initialBtcDrop: number;
  ethPriceUsd: number | null;
  btcPriceUsd: number | null;
}

export function StressSliders({
  initialWethDrop,
  initialBtcDrop,
  ethPriceUsd,
  btcPriceUsd,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [weth, setWeth] = useState(initialWethDrop);
  const [btc, setBtc] = useState(initialBtcDrop);

  const commit = (nextWeth: number, nextBtc: number) => {
    const next = new URLSearchParams(sp.toString());
    if (nextWeth === 0) next.delete("weth");
    else next.set("weth", String(nextWeth));
    if (nextBtc === 0) next.delete("btc");
    else next.set("btc", String(nextBtc));
    const qs = next.toString();
    router.push(qs ? `/stress?${qs}` : "/stress");
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <SliderRow
        label="WETH drop"
        symbol="WETH"
        value={weth}
        priceUsd={ethPriceUsd}
        onChange={(v) => setWeth(v)}
        onCommit={(v) => commit(v, btc)}
      />
      <SliderRow
        label="cbBTC / BTC drop"
        symbol="cbBTC"
        value={btc}
        priceUsd={btcPriceUsd}
        onChange={(v) => setBtc(v)}
        onCommit={(v) => commit(weth, v)}
      />
    </div>
  );
}

function SliderRow({
  label,
  symbol,
  value,
  priceUsd,
  onChange,
  onCommit,
}: {
  label: string;
  symbol: string;
  value: number;
  priceUsd: number | null;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const stressedPrice = priceUsd !== null ? priceUsd * (1 - value / 100) : null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <label
          htmlFor={`stress-${symbol}`}
          className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]"
        >
          {label}
        </label>
        <span className="font-mono text-sm">−{value}%</span>
      </div>
      <input
        id={`stress-${symbol}`}
        type="range"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
      <p className="text-[11px] text-[color:var(--muted)] mt-2 font-mono">
        {priceUsd !== null && stressedPrice !== null
          ? `${symbol}: $${priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} → $${stressedPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : `no oracle price for ${symbol}`}
      </p>
    </div>
  );
}
