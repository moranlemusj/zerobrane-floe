/**
 * Auth header builders for Floe `credit-api`.
 *
 * Two modes:
 *   - **API key**:  `Authorization: Bearer floe_live_...` (primary mode for
 *                   most endpoints accessible to a developer key)
 *   - **Wallet sig** (EIP-191): `X-Wallet-Address`, `X-Signature`, `X-Timestamp`.
 *                   Required for endpoints that gate on wallet identity
 *                   (verified shape: `Floe Credit API\nTimestamp: <unix_seconds>`,
 *                   personal_sign per EIP-191, 5-minute validity, no nonce).
 *
 * Some endpoints are public (no auth). The client picks the mode per-endpoint.
 */

/** The exact message Floe expects to be EIP-191 personal_signed. */
export function floeAuthMessage(timestamp: number): string {
  return `Floe Credit API\nTimestamp: ${timestamp}`;
}

export interface AuthContext {
  apiKey?: string;
  walletAddress?: string;
  /**
   * Sign the canonical Floe-auth message with EIP-191 personal_sign and
   * return the signature as a 0x-prefixed 65-byte hex string.
   *
   * Implementations:
   *
   * ```ts
   * import { privateKeyToAccount } from "viem/accounts";
   * const account = privateKeyToAccount("0x...");
   * walletSigner: (message) => account.signMessage({ message })
   * ```
   *
   * Or with ethers:
   *
   * ```ts
   * walletSigner: (message) => wallet.signMessage(message)
   * ```
   *
   * Or with a browser wallet (window.ethereum):
   *
   * ```ts
   * walletSigner: async (message) =>
   *   await window.ethereum.request({
   *     method: "personal_sign",
   *     params: [message, address],
   *   })
   * ```
   */
  walletSigner?: (message: string) => Promise<`0x${string}` | string>;
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
  const message = floeAuthMessage(timestamp);
  const signature = await ctx.walletSigner(message);
  return {
    "X-Wallet-Address": ctx.walletAddress,
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };
}
