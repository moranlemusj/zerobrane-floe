/**
 * viem clients + DB client — built once at indexer startup, shared
 * across modules.
 *
 * `httpClient` is always defined; `wssClient` is set only when
 * `BASE_WSS_URL` is configured. Subscription code prefers WSS when
 * available, falls back to polling over HTTP otherwise.
 */

import { createPublicClient, http, webSocket, type PublicClient } from "viem";
import { base } from "viem/chains";
import { createDb, type Db } from "@floe-dashboard/data";

export interface IndexerClients {
  /** WebSocket-backed client for subscriptions. Null when BASE_WSS_URL is unset. */
  wssClient: PublicClient | null;
  /** HTTP client — always present. Used for backfill, view reads, and as a
   *  subscription fallback when WSS isn't configured. */
  httpClient: PublicClient;
  /** Drizzle DB handle. */
  db: Db;
  /** True when wssClient is set. */
  hasWebSocket: boolean;
}

/** Last-resort fallback when no provider env is set. The official
 *  `mainnet.base.org` rate-limits to ~5 req/burst, so we default to
 *  llamarpc which is friendlier for read-heavy workloads. */
export const FREE_BASE_RPC = "https://base.llamarpc.com";

interface RpcUrls {
  http: string;
  wss: string | null;
  source: "explicit-env" | "alchemy-key" | "free-default";
}

/**
 * Resolve which RPC endpoints to use, in priority order:
 *
 *   1. Explicit `BASE_RPC_URL` / `BASE_WSS_URL` envs (always wins).
 *   2. `ALCHEMY_API_KEY` env → derive both URLs from the canonical
 *      Alchemy hostnames for Base mainnet.
 *   3. `FREE_BASE_RPC` (llamarpc) for HTTP, no WSS.
 */
export function resolveRpcUrls(): RpcUrls {
  const explicitHttp = process.env.BASE_RPC_URL?.trim();
  const explicitWss = process.env.BASE_WSS_URL?.trim();
  if (explicitHttp || explicitWss) {
    return {
      http: explicitHttp || FREE_BASE_RPC,
      wss: explicitWss || null,
      source: "explicit-env",
    };
  }
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim();
  if (alchemyKey) {
    return {
      http: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      wss: `wss://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      source: "alchemy-key",
    };
  }
  return { http: FREE_BASE_RPC, wss: null, source: "free-default" };
}

export function buildClients(): IndexerClients & { rpcSource: RpcUrls["source"] } {
  const urls = resolveRpcUrls();

  const httpClient = createPublicClient({
    chain: base,
    // batch: false — Alchemy rejects some batched JSON-RPC payloads
    // ("JSON is not a valid request object"). Single requests are fine
    // and don't materially impact our throughput.
    transport: http(urls.http),
  }) as PublicClient;

  const wssClient = urls.wss
    ? (createPublicClient({ chain: base, transport: webSocket(urls.wss) }) as PublicClient)
    : null;

  const db = createDb();

  return {
    wssClient,
    httpClient,
    db,
    hasWebSocket: !!urls.wss,
    rpcSource: urls.source,
  };
}

/**
 * Probe the configured HTTP RPC. If Alchemy responds with a "network not
 * enabled" message (non-JSON plain text), fall back to the free RPC and
 * log a clear remediation step.
 */
export async function buildClientsWithFallback(): Promise<
  IndexerClients & { rpcSource: RpcUrls["source"]; warnings: string[] }
> {
  const warnings: string[] = [];
  let clients = buildClients();

  if (clients.rpcSource === "alchemy-key") {
    try {
      await clients.httpClient.getBlockNumber();
    } catch (err) {
      const msg = (err as Error).message;
      if (/not enabled|not valid JSON|Unauthorized/i.test(msg)) {
        warnings.push(
          "Alchemy rejected the request. The likely cause: your Alchemy app doesn't have Base Mainnet enabled.\n" +
            "Fix: open the Alchemy dashboard, find this app, and toggle 'Base Mainnet' on.\n" +
            "Falling back to free RPC (https://base.llamarpc.com) for this run.",
        );
        // Force fallback to free RPC.
        const httpClient = createPublicClient({
          chain: base,
          transport: http(FREE_BASE_RPC, { batch: true }),
        }) as PublicClient;
        clients = {
          ...clients,
          wssClient: null,
          httpClient,
          hasWebSocket: false,
          rpcSource: "free-default",
        };
      } else {
        throw err;
      }
    }
  }

  return { ...clients, warnings };
}

/** Return whichever client is best for subscriptions: WSS if set, else HTTP (poll). */
export function preferWss(clients: IndexerClients): PublicClient {
  return clients.wssClient ?? clients.httpClient;
}
