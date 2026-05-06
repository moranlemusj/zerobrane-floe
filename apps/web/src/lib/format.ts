/**
 * Display helpers shared across the dashboard.
 */

const TOKEN_SYMBOLS: Record<string, { symbol: string; decimals: number }> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", decimals: 8 },
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT", decimals: 6 },
};

export function tokenInfo(addr: string): { symbol: string; decimals: number } {
  return TOKEN_SYMBOLS[addr.toLowerCase()] ?? { symbol: "?", decimals: 18 };
}

/** Format a raw uint256 amount string against a token's decimals. */
export function formatAmount(rawAmount: string | null, decimals: number, displayDecimals = 4): string {
  if (rawAmount === null) return "—";
  try {
    const v = BigInt(rawAmount);
    const negative = v < 0n;
    const abs = negative ? -v : v;
    const unit = 10n ** BigInt(decimals);
    const whole = abs / unit;
    const frac = abs % unit;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, displayDecimals).replace(/0+$/, "");
    const out = fracStr ? `${whole}.${fracStr}` : `${whole}`;
    return negative ? `-${out}` : out;
  } catch {
    return rawAmount;
  }
}

export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function basescanAddressUrl(addr: string): string {
  return `https://basescan.org/address/${addr}`;
}

export function basescanTxUrl(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}

/** LTV-buffer health bands per the dashboard PRD. */
export type HealthBand = "healthy" | "warning" | "at_risk" | "liquidatable" | "closed";

export function healthBand(opts: {
  state: string;
  currentLtvBps: number | null;
  liquidationLtvBps: number;
  isUnderwater: boolean | null;
}): HealthBand {
  if (opts.state !== "active") return "closed";
  if (opts.isUnderwater === true) return "liquidatable";
  if (opts.currentLtvBps == null) return "warning";
  const buffer = opts.liquidationLtvBps - opts.currentLtvBps;
  if (buffer < 0) return "liquidatable";
  if (buffer < 500) return "at_risk";
  if (buffer < 2000) return "warning";
  return "healthy";
}

export const HEALTH_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  warning: "Warning",
  at_risk: "At risk",
  liquidatable: "Liquidatable",
  closed: "Closed",
};

export const HEALTH_CLASS: Record<HealthBand, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  at_risk: "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30",
  liquidatable: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
  closed: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30",
};

export const STATE_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  repaid: "Repaid",
  liquidated: "Liquidated",
  expired: "Expired",
};
