/**
 * Sync the markets table from Floe's public REST `/v1/markets`.
 * Cheap; called at boot and every ~10 min thereafter.
 */

import { createFloeClient } from "@floe-agents/core";
import type { Db } from "@floe-dashboard/data";
import { markets } from "@floe-dashboard/data";

export async function syncMarkets(db: Db): Promise<number> {
  const floe = createFloeClient(); // public endpoint, no auth needed
  const { markets: live } = await floe.getMarkets();
  for (const m of live) {
    await db
      .insert(markets)
      .values({
        marketId: m.marketId,
        loanTokenAddress: m.loanToken.address,
        loanTokenSymbol: m.loanToken.symbol,
        loanTokenDecimals: m.loanToken.decimals,
        collateralTokenAddress: m.collateralToken.address,
        collateralTokenSymbol: m.collateralToken.symbol,
        collateralTokenDecimals: m.collateralToken.decimals,
        isActive: m.isActive,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: markets.marketId,
        set: {
          loanTokenSymbol: m.loanToken.symbol,
          collateralTokenSymbol: m.collateralToken.symbol,
          isActive: m.isActive,
          lastSyncedAt: new Date(),
        },
      });
  }
  return live.length;
}
