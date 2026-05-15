/**
 * Synthetic match-tx receipt fixture.
 *
 * A typical match tx contains (at minimum) three ERC-20 Transfer logs:
 *   1. lender → matcher: commission (matcherCommissionBps × principal)
 *   2. lender → borrower: net disbursement (principal − commission)
 *   3. borrower → matcher (or vault): collateral
 *
 * The "matched principal" — what the borrower OWES — equals the lender's
 * total loanToken commitment in this tx (#1 + #2). It is NOT the amount
 * the borrower received (#2 only); the matcher commission is part of the
 * principal that the borrower must repay.
 */
import type { TransactionReceipt } from "viem";

export const LENDER = "0x1111111111111111111111111111111111111111";
export const BORROWER = "0x2222222222222222222222222222222222222222";
export const MATCHER = "0x3333333333333333333333333333333333333333";
export const LOAN_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
export const COLLATERAL_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // cbBTC

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const padAddr = (addr: string) =>
  ("0x" + "0".repeat(24) + addr.toLowerCase().slice(2)) as `0x${string}`;

const padU256 = (n: bigint) => {
  const hex = n.toString(16);
  return ("0x" + hex.padStart(64, "0")) as `0x${string}`;
};

function transferLog(opts: {
  token: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}) {
  return {
    address: opts.token as `0x${string}`,
    topics: [
      TRANSFER_TOPIC as `0x${string}`,
      padAddr(opts.from),
      padAddr(opts.to),
    ] as readonly `0x${string}`[],
    data: padU256(opts.value),
    blockHash: "0x0" as `0x${string}`,
    blockNumber: 1n,
    logIndex: opts.logIndex,
    transactionHash: "0x0" as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  };
}

export const MATCHED_PRINCIPAL = 5_000_000n; // 5 USDC
export const COMMISSION = 50_000n; // 0.05 USDC (1% of principal)
export const NET_DISBURSED = MATCHED_PRINCIPAL - COMMISSION; // 4.95 USDC
export const COLLATERAL_POSTED = 1_000_000n; // 0.01 cbBTC

export const matchReceipt: TransactionReceipt = {
  status: "success",
  type: "eip1559",
  transactionHash: "0x0",
  transactionIndex: 0,
  blockHash: "0x0",
  blockNumber: 1n,
  from: LENDER as `0x${string}`,
  to: MATCHER as `0x${string}`,
  cumulativeGasUsed: 0n,
  gasUsed: 0n,
  effectiveGasPrice: 0n,
  contractAddress: null,
  logsBloom: "0x0",
  logs: [
    // lender → matcher: commission
    transferLog({
      token: LOAN_TOKEN,
      from: LENDER,
      to: MATCHER,
      value: COMMISSION,
      logIndex: 0,
    }),
    // lender → borrower: net disbursement
    transferLog({
      token: LOAN_TOKEN,
      from: LENDER,
      to: BORROWER,
      value: NET_DISBURSED,
      logIndex: 1,
    }),
    // borrower → matcher: collateral
    transferLog({
      token: COLLATERAL_TOKEN,
      from: BORROWER,
      to: MATCHER,
      value: COLLATERAL_POSTED,
      logIndex: 2,
    }),
  ],
} as unknown as TransactionReceipt;
