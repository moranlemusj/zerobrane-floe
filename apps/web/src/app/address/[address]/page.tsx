import { notFound } from "next/navigation";
import { isAddress } from "viem";
import { LoanTable } from "@/components/LoanTable";
import {
  basescanAddressUrl,
  formatAmount,
  shortAddress,
  tokenInfo,
} from "@/lib/format";
import { getAddressStats, listLoans } from "@/lib/queries";

export const dynamic = "force-dynamic";

// USDC is the dominant loan-token; we display sums in it. Borrower-side
// has been all USDC/USDT historically — close enough for a portfolio rollup.
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export default async function AddressPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const lower = address.toLowerCase();

  const [stats, asBorrower, asLender] = await Promise.all([
    getAddressStats(lower),
    listLoans({ filter: { borrower: lower }, sort: "matchedAt", direction: "desc", limit: 100 }),
    listLoans({ filter: { lender: lower }, sort: "matchedAt", direction: "desc", limit: 100 }),
  ]);

  const usdc = tokenInfo(USDC);
  const totalIn = (raw: string) => `${formatAmount(raw, usdc.decimals, 2)} ${usdc.symbol}`;

  const isInvolved =
    stats.asBorrower > 0 || stats.asLender > 0 || stats.asOperator > 0;

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="text-[color:var(--muted)] font-normal text-base">Address ·</span>{" "}
          <span className="font-mono">{shortAddress(lower)}</span>
        </h1>
        <p className="text-xs text-[color:var(--muted)] mt-1 font-mono break-all">
          {lower}{" "}
          <a
            href={basescanAddressUrl(lower)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            ↗ basescan
          </a>
        </p>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="As borrower" value={`${stats.asBorrower}`} sub={`${stats.activeAsBorrower} active`} />
        <Stat label="As lender" value={`${stats.asLender}`} sub={`${stats.activeAsLender} active`} />
        <Stat label="As operator" value={`${stats.asOperator}`} />
        <Stat label="Total borrowed" value={totalIn(stats.totalBorrowedRaw)} sub="lifetime, in USDC equiv." />
        <Stat label="Total lent" value={totalIn(stats.totalLentRaw)} sub="lifetime, in USDC equiv." />
        <Stat label="Interest paid" value={totalIn(stats.totalInterestPaidRaw)} sub="across closed loans" />
      </section>

      {!isInvolved && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-[color:var(--muted)]">
          <p>This address has no recorded activity on Floe within our indexed range.</p>
          <p className="mt-2 text-[11px]">
            Either it's never interacted with the matcher, or its activity is older than the
            indexer's backfill window.
          </p>
        </div>
      )}

      {asBorrower.total > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            As borrower{" "}
            <span className="text-xs text-[color:var(--muted)] font-normal">
              ({asBorrower.total} loans)
            </span>
          </h2>
          <LoanTable
            rows={asBorrower.rows}
            total={asBorrower.total}
            offset={0}
            limit={100}
            searchParams={{ borrower: lower }}
          />
        </section>
      )}

      {asLender.total > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            As lender{" "}
            <span className="text-xs text-[color:var(--muted)] font-normal">
              ({asLender.total} loans)
            </span>
          </h2>
          <LoanTable
            rows={asLender.rows}
            total={asLender.total}
            offset={0}
            limit={100}
            searchParams={{ lender: lower }}
          />
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{label}</dt>
      <dd className="text-base font-mono mt-1">{value}</dd>
      {sub && <p className="text-[11px] text-[color:var(--muted)] mt-0.5">{sub}</p>}
    </div>
  );
}
