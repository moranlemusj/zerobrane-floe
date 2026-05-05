import type { UsdcAmount } from "./types.js";

/**
 * Wire-shape helpers. Live Floe `credit-api` uses decimal strings for amounts
 * to avoid JSON-number precision loss. These helpers convert at the boundary.
 */

export function rawToUsdc(raw: string | number | undefined | null): UsdcAmount {
  if (raw === undefined || raw === null || raw === "") return 0n;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error(`rawToUsdc: non-finite number ${raw}`);
    return BigInt(Math.trunc(raw));
  }
  if (!/^-?\d+$/.test(raw)) throw new Error(`rawToUsdc: invalid raw "${raw}"`);
  return BigInt(raw);
}

export function rawToUsdcNullable(raw: string | number | undefined | null): UsdcAmount | null {
  if (raw === undefined || raw === null) return null;
  return rawToUsdc(raw);
}

export function usdcToRaw(amount: UsdcAmount): string {
  return amount.toString();
}

export function bpsToNumber(bps: string | number): number {
  if (typeof bps === "number") return bps;
  if (!/^-?\d+$/.test(bps)) throw new Error(`bpsToNumber: invalid bps "${bps}"`);
  return Number(bps);
}

export function numberToInt(v: string | number): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`numberToInt: non-finite ${v}`);
    return Math.trunc(v);
  }
  if (!/^-?\d+$/.test(v)) throw new Error(`numberToInt: invalid "${v}"`);
  return Number(v);
}
