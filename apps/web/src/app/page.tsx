import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";
import { Filters } from "@/components/Filters";
import { KpiCards } from "@/components/KpiCards";
import { LoanTable } from "@/components/LoanTable";
import { getKpis, listLoans, type LoanQueryOptions } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatten(await searchParams);

  const limit = clampInt(params.limit, 50, 1, 200);
  const offset = clampInt(params.offset, 0, 0, 1_000_000);
  const sort = (params.sort as LoanQueryOptions["sort"]) ?? "currentLtv";
  const dir = (params.dir as LoanQueryOptions["direction"]) ?? "desc";

  const filter: LoanQueryOptions["filter"] = {};
  if (params.status) filter.status = params.status as never;
  if (params.collateral) filter.collateralToken = params.collateral;

  const [{ rows, total }, kpis, session] = await Promise.all([
    listLoans({ filter, sort, direction: dir, limit, offset }),
    getKpis(),
    getSession(),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Floe — Loan Dashboard</h1>
          <p className="text-sm text-[color:var(--muted)] mt-1">
            Real-time view of every loan on Floe's onchain credit protocol on Base.
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="px-2 py-1 hover:underline">
            Loans
          </Link>
          <Link href="/markets" className="px-2 py-1 hover:underline">
            Markets
          </Link>
          <Link href="/me" className="px-2 py-1 hover:underline">
            My loans
          </Link>
          <Link href="/chat" className="px-2 py-1 hover:underline">
            Chat
          </Link>
          <ConnectButton initialAddress={session.address ?? undefined} />
        </nav>
      </header>

      <KpiCards kpis={kpis} />

      <Filters searchParams={params} />

      <LoanTable
        rows={rows}
        total={total}
        offset={offset}
        limit={limit}
        searchParams={params}
      />
    </main>
  );
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function flatten(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v[0] !== undefined) out[k] = v[0];
  }
  return out;
}
