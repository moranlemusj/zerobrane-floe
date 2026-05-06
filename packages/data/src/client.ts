import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Build a Drizzle client over Neon's serverless HTTP driver.
 *
 * Both the indexer and the web app create a client per-process from
 * `NEON_DATABASE_URL`. Neon HTTP is connection-pooled by Neon itself —
 * no warm-pool to manage on our side, and it works in serverless
 * functions (Vercel Route Handlers) without per-request connection cost.
 */

export interface CreateDbOptions {
  /** Override the connection string (defaults to NEON_DATABASE_URL). */
  url?: string;
}

export function createDb(opts: CreateDbOptions = {}) {
  const url = opts.url ?? process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error(
      "createDb: NEON_DATABASE_URL not set. Add it to .env at the repo root, or pass `{ url }`.",
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
