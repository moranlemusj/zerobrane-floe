/**
 * Probe wallet-signature auth against Floe's credit-api.
 *
 * Verifies the EIP-191 message format documented at
 *   https://floe-labs.gitbook.io/docs/developers/credit-api#wallet-signature-authentication-eip-191
 * works in practice for endpoints that 401 with our developer Bearer key.
 *
 * Requires `FLOE_DEV_PRIVATE_KEY=0x...` in .env. **Use a fresh test wallet,
 * not your main one.** This key only signs read-only auth messages — nothing
 * custodial — but treat it as compromised once it's in any .env file.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env scripts/probe-walletsig.ts
 */

import { privateKeyToAccount } from "viem/accounts";
import { floeAuthMessage } from "../packages/core/src/auth.js";

const FLOE_API = "https://credit-api.floelabs.xyz";

async function main() {
  const pk = process.env.FLOE_DEV_PRIVATE_KEY;
  if (!pk) {
    console.error(
      "FLOE_DEV_PRIVATE_KEY not set. Add it to .env (use a FRESH test wallet, not your main one).",
    );
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error("FLOE_DEV_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
    process.exit(1);
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`[probe] wallet address: ${account.address}`);

  const timestamp = Math.floor(Date.now() / 1000);
  const message = floeAuthMessage(timestamp);
  const signature = await account.signMessage({ message });
  console.log(`[probe] timestamp: ${timestamp}`);
  console.log(`[probe] message:   ${JSON.stringify(message)}`);
  console.log(`[probe] signature: ${signature.slice(0, 20)}…${signature.slice(-8)}`);

  const headers = {
    "X-Wallet-Address": account.address,
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };

  const probes: Array<[string, string, RequestInit?]> = [
    ["/v1/credit/status/1", "GET"],
    [`/v1/positions/${account.address}`, "GET"],
    [`/v1/positions/0x4c10b67fac64d15c0a09918059c59f41fbcafec0`, "GET"],
    ["/v1/developer/profile", "GET"],
    [
      "/v1/x402/estimate",
      "POST",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://api.example.com/test", method: "GET" }),
        headers: { "Content-Type": "application/json" },
      },
    ],
    [
      "/v1/markets/0xfe92656527bae8e6d37a9e0bb785383fbb33f1f0c7e29fdd733f5af7390c2930/cost-of-capital?borrowAmount=1000000000&duration=2592000",
      "GET",
    ],
  ];

  for (const [path, method, init] of probes) {
    const url = `${FLOE_API}${path}`;
    const fullInit: RequestInit = init ?? { method };
    fullInit.headers = { ...headers, ...(fullInit.headers ?? {}) };
    try {
      const res = await fetch(url, fullInit);
      const text = await res.text();
      const trimmed = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      console.log(`\n${method.padEnd(4)} ${path}`);
      console.log(`  HTTP ${res.status}  ${trimmed}`);
    } catch (e) {
      console.log(`\n${method.padEnd(4)} ${path}`);
      console.log(`  threw: ${(e as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
