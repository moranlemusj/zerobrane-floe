/**
 * Auth header builders for Floe `credit-api`.
 *
 * Two modes:
 *   - API key:  `Authorization: Bearer floe_live_...` (primary mode for agents)
 *   - Wallet:   EIP-191 signature headers `X-Wallet-Address`, `X-Signature`, `X-Timestamp`
 *
 * Some endpoints are public (no auth). The client picks the mode per-endpoint.
 */

export interface AuthContext {
  apiKey?: string;
  walletAddress?: string;
  walletSigner?: (msg: { address: string; timestamp: number }) => Promise<string>;
}

export type AuthMode = "api_key" | "wallet" | "public";

export async function buildAuthHeaders(
  ctx: AuthContext,
  preferred: AuthMode = "api_key",
): Promise<Record<string, string>> {
  if (preferred === "public") return {};

  if (preferred === "api_key") {
    if (ctx.apiKey) return { Authorization: `Bearer ${ctx.apiKey}` };
    if (ctx.walletSigner && ctx.walletAddress) return walletHeaders(ctx);
    throw new Error(
      "Floe auth required: pass apiKey, or walletSigner + walletAddress, in FloeClientOptions.",
    );
  }

  // wallet mode
  if (ctx.walletSigner && ctx.walletAddress) return walletHeaders(ctx);
  if (ctx.apiKey) return { Authorization: `Bearer ${ctx.apiKey}` };
  throw new Error(
    "Floe wallet auth required: pass walletSigner + walletAddress in FloeClientOptions.",
  );
}

async function walletHeaders(ctx: AuthContext): Promise<Record<string, string>> {
  if (!ctx.walletSigner || !ctx.walletAddress) {
    throw new Error("walletHeaders: ctx.walletSigner and ctx.walletAddress are required");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await ctx.walletSigner({
    address: ctx.walletAddress,
    timestamp,
  });
  return {
    "X-Wallet-Address": ctx.walletAddress,
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };
}
