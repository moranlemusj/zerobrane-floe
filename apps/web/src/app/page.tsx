import { sql } from "drizzle-orm";
import { createDb, loans, markets } from "@floe-dashboard/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = createDb();
  const [marketsCount, loansCount, dbInfo] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS c FROM ${markets}`),
    db.execute(sql`SELECT COUNT(*)::int AS c FROM ${loans}`),
    db.execute(sql`SELECT now() AS now, current_database() AS db`),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Floe Dashboard</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Real-time view of every active loan on Floe's onchain credit protocol.
        </p>
      </header>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-lg font-medium mb-3">Phase 2 wiring check</h2>
        <p className="text-sm text-[color:var(--muted)] mb-4">
          The Next app + Neon + indexer are wired together. Below is a live read from
          the database. Phase 3 fills it with chain data.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-[color:var(--muted)]">Markets in DB</dt>
            <dd className="text-2xl font-mono mt-1">
              {(marketsCount.rows[0] as { c: number }).c}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">Loans in DB</dt>
            <dd className="text-2xl font-mono mt-1">
              {(loansCount.rows[0] as { c: number }).c}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">DB</dt>
            <dd className="text-sm font-mono mt-1 break-all">
              {(dbInfo.rows[0] as { db: string }).db}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-lg font-medium mb-3">What's next</h2>
        <ul className="text-sm text-[color:var(--muted)] space-y-1 list-disc pl-5">
          <li>Phase 3 — indexer subscribes to matcher + Chainlink, populates the DB</li>
          <li>Phase 4 — loan table, filters, market aggregates land here</li>
          <li>Phase 5 — /chat with read-only tools over the same DB</li>
          <li>Phase 6 — /me with EIP-191 wallet sign-in</li>
        </ul>
      </section>
    </main>
  );
}
