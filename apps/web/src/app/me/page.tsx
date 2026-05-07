import { LoanTable } from "@/components/LoanTable";
import { listLoans } from "@/lib/queries";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const session = await getSession();
  const address = session.address ?? null;

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your loans</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          {address
            ? `Showing loans where the borrower is ${address}.`
            : "Connect your wallet (top right) and sign a message to view loans you originated."}
        </p>
      </div>

      {address ? (
        <MyLoans address={address} />
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-[color:var(--muted)]">
          <p>No active session. Click "Connect wallet" to sign in.</p>
          <p className="mt-2 text-[11px]">
            Sign-in is EIP-191 — you sign a plain-text message proving wallet ownership.
            No transaction is sent and no gas is spent.
          </p>
        </div>
      )}
    </main>
  );
}

async function MyLoans({ address }: { address: string }) {
  const { rows, total } = await listLoans({
    filter: { borrower: address },
    sort: "matchedAt",
    direction: "desc",
    limit: 50,
  });

  if (total === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-12 text-center text-sm text-[color:var(--muted)]">
        <p>No loans found for {address}.</p>
        <p className="mt-2 text-[11px]">
          Either this wallet hasn't borrowed on Floe yet, or its loans are outside our
          indexed range.
        </p>
      </div>
    );
  }

  return (
    <LoanTable
      rows={rows}
      total={total}
      offset={0}
      limit={50}
      searchParams={{ borrower: address }}
    />
  );
}
