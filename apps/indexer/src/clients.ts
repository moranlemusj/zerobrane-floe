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

export const DEFAULT_BASE_RPC = "https://mainnet.base.org";

export function buildClients(): IndexerClients {
  const wssUrl = process.env.BASE_WSS_URL?.trim();
  const httpUrl = process.env.BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC;

  const httpClient = createPublicClient({
    chain: base,
    transport: http(httpUrl, { batch: true }),
  }) as PublicClient;

  const wssClient = wssUrl
    ? (createPublicClient({ chain: base, transport: webSocket(wssUrl) }) as PublicClient)
    : null;

  const db = createDb();

  return { wssClient, httpClient, db, hasWebSocket: !!wssUrl };
}

/** Return whichever client is best for subscriptions: WSS if set, else HTTP (poll). */
export function preferWss(clients: IndexerClients): PublicClient {
  return clients.wssClient ?? clients.httpClient;
}
