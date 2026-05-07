/**
 * iron-session config + helper. Server-only — never import from a
 * client component.
 */

import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface SessionData {
  /** Verified wallet address (lowercase). Set after EIP-191 sig check. */
  address?: `0x${string}`;
  /** Per-sign-in nonce, set during /nonce, consumed by /verify. */
  nonce?: string;
  nonceCreatedAt?: number;
}

const password = process.env.IRON_SESSION_PASSWORD;
if (!password || password.length < 32) {
  // Throw lazily — server actions will surface the error.
  // Keep this defensive so dev with no env var fails loudly.
}

const options: SessionOptions = {
  password: password ?? "x".repeat(32),
  cookieName: "floe_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options);
}

/** Build the message a wallet signs to prove ownership. EIP-191 plain text. */
export function buildAuthMessage(address: string, nonce: string): string {
  const lines = [
    "Sign in to Floe Dashboard.",
    "",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "",
    "Signing this message proves wallet ownership. No transaction is sent.",
  ];
  return lines.join("\n");
}
