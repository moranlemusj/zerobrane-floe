/**
 * Find a non-repaid loan via getLoan() and probe Floe's REST status endpoint.
 *
 * Run:
 *   FLOE_DEV_PRIVATE_KEY=0x... pnpm exec tsx --env-file=.env scripts/probe-active-loan.ts
 */

import { createPublicClient, http, getAddress, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { floeAuthMessage } from "../packages/core/src/auth.js";

const MATCHER = getAddress("0x17946cD3e180f82e632805e5549EC913330Bb175");
const FLOE_API = "https://credit-api.floelabs.xyz";

// Just enough of getLoan for this probe.
const matcherAbi = parseAbi([
  "function getLoan(uint256 loanId) view returns ((bytes32 marketId, uint256 loanId, address lender, address borrower, address loanToken, address collateralToken, uint256 principal, uint256 interestRateBps, uint256 ltvBps, uint256 liquidationLtvBps, uint256 marketFeeBps, uint256 matcherCommissionBps, uint256 startTime, uint256 duration, uint256 collateralAmount, bool repaid, uint256 gracePeriod, uint256 minInterestBps, address operator))",
]);

async function main() {
  const pk = process.env.FLOE_DEV_PRIVATE_KEY;
  if (!pk) {
    console.error("FLOE_DEV_PRIVATE_KEY not set");
    process.exit(1);
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  const client = createPublicClient({ chain: base, transport: http() });

  console.log(`[probe] using wallet: ${account.address}`);

  // Walk loan IDs 1..50 looking for non-zero, non-repaid loans.
  const found: Array<{ id: bigint; repaid: boolean; principal: bigint; collateralAmount: bigint }> = [];
  for (let id = 1n; id < 50n; id++) {
    try {
      const loan = (await client.readContract({
        address: MATCHER,
        abi: matcherAbi,
        functionName: "getLoan",
        args: [id],
      })) as {
        borrower: `0x${string}`;
        repaid: boolean;
        principal: bigint;
        collateralAmount: bigint;
      };
      if (loan.borrower !== "0x0000000000000000000000000000000000000000") {
        found.push({
          id,
          repaid: loan.repaid,
          principal: loan.principal,
          collateralAmount: loan.collateralAmount,
        });
      }
    } catch {
      // skip
    }
  }
  console.log(`[probe] discovered loans (id 1..49):`);
  for (const f of found) {
    console.log(
      `  loanId=${f.id} repaid=${f.repaid} principal=${f.principal} collateral=${f.collateralAmount}`,
    );
  }

  const active = found.filter((f) => !f.repaid);
  if (active.length === 0) {
    console.log(`\n[probe] No active (non-repaid) loans found in 1..49.`);
    console.log(`        Trying anyway with the first loan we did find.`);
  }

  const sample = active[0] ?? found[0];
  if (!sample) {
    console.log(`[probe] No loans at all in 1..49 — extending to 1..200`);
    return;
  }

  console.log(`\n[probe] testing /v1/credit/status/${sample.id} (repaid=${sample.repaid})`);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = floeAuthMessage(timestamp);
  const signature = await account.signMessage({ message });
  const headers = {
    "X-Wallet-Address": account.address,
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };
  const res = await fetch(`${FLOE_API}/v1/credit/status/${sample.id}`, { headers });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }

  // Also try a couple more for resilience.
  for (const other of found.slice(1, 4)) {
    console.log(`\n[probe] /v1/credit/status/${other.id} (repaid=${other.repaid})`);
    const r = await fetch(`${FLOE_API}/v1/credit/status/${other.id}`, { headers });
    const t = await r.text();
    console.log(`  HTTP ${r.status}  ${t.length > 200 ? t.slice(0, 200) + "…" : t}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
