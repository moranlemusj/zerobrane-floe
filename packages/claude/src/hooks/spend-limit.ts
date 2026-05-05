import type { FloeClient, SpendLimit, UsdcAmount } from "@floe-agents/core";

/**
 * Spend-limit setup helpers. Floe's spend limit is server-side, enforced
 * by the credit-api itself, so these are simple one-shot calls — not hooks.
 *
 * Apply once before `query()`, clear when done. A misbehaving hook can't
 * exceed the cap because the server is authoritative.
 */

export interface ApplySpendLimitOptions {
  client: FloeClient;
  limit: UsdcAmount;
}

export async function floeApplySpendLimit({
  client,
  limit,
}: ApplySpendLimitOptions): Promise<SpendLimit> {
  return await client.setSpendLimit({ limit });
}

export async function floeClearSpendLimit(client: FloeClient): Promise<void> {
  await client.clearSpendLimit();
}

export async function floeGetSpendLimit(client: FloeClient): Promise<SpendLimit | null> {
  return await client.getSpendLimit();
}
