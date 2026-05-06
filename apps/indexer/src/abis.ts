/**
 * ABI loader — fetches verified ABIs from Sourcify at indexer startup,
 * caches them in memory for the process lifetime.
 *
 * Why fetch instead of bundling JSON: Floe upgrades the matcher
 * implementation periodically (EIP-1967). Pulling at startup means we
 * always decode against the current implementation without a redeploy.
 * If Floe's matcher is ever swapped to a brand-new ABI, this picks it
 * up automatically as long as Sourcify has it verified.
 *
 * Falls back gracefully: if Sourcify is unreachable, we use a hardcoded
 * minimal ABI (events only) to keep the indexer alive. Hydration may
 * miss some fields until Sourcify recovers.
 */

import {
  type Abi,
  type AbiEvent,
  type Address,
  getAddress,
  parseAbi,
} from "viem";
import { CONTRACTS } from "./contracts";

// EIP-1967 implementation slot.
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

interface MinimalReadClient {
  getStorageAt(args: { address: `0x${string}`; slot: `0x${string}` }): Promise<`0x${string}` | undefined>;
}

/** Resolve a proxy's implementation address via EIP-1967, or null if not a proxy. */
async function readImplementation(
  client: MinimalReadClient,
  proxy: `0x${string}`,
): Promise<`0x${string}` | null> {
  try {
    const slot = await client.getStorageAt({ address: proxy, slot: EIP1967_IMPL_SLOT });
    if (!slot || slot === "0x" || /^0x0+$/.test(slot)) return null;
    const addr = `0x${slot.slice(-40)}`.toLowerCase() as `0x${string}`;
    if (/^0x0+$/.test(addr)) return null;
    return getAddress(addr);
  } catch {
    return null;
  }
}

async function fetchSourcifyAbi(address: Address): Promise<Abi | null> {
  for (const matchType of ["full_match", "partial_match"] as const) {
    const url = `https://repo.sourcify.dev/contracts/${matchType}/8453/${address}/metadata.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const meta = (await res.json()) as { output?: { abi?: Abi } };
        if (meta.output?.abi) return meta.output.abi;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/** Fetch the implementation ABI for a proxy (or the direct ABI for a non-proxy). */
async function resolveContractAbi(
  client: MinimalReadClient,
  address: Address,
): Promise<Abi | null> {
  const direct = await fetchSourcifyAbi(address);
  if (direct) {
    const isTinyProxyAbi =
      direct.length <= 10 &&
      direct.some((e) => "type" in e && e.type === "event" && "name" in e && e.name === "Upgraded");
    if (isTinyProxyAbi) {
      const impl = await readImplementation(client, address);
      if (impl) {
        const implAbi = await fetchSourcifyAbi(impl);
        if (implAbi) return implAbi;
      }
    }
    return direct;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Hardcoded fallback ABIs — used when Sourcify is unreachable.
// Just the surfaces we care about for indexing + hydration.
// -----------------------------------------------------------------------------

const MATCHER_VIEWS_FALLBACK = parseAbi([
  "function getLoan(uint256 loanId) view returns ((bytes32 marketId, uint256 loanId, address lender, address borrower, address loanToken, address collateralToken, uint256 principal, uint256 interestRateBps, uint256 ltvBps, uint256 liquidationLtvBps, uint256 marketFeeBps, uint256 matcherCommissionBps, uint256 startTime, uint256 duration, uint256 collateralAmount, bool repaid, uint256 gracePeriod, uint256 minInterestBps, address operator))",
  "function getCurrentLtvBps(uint256 loanId) view returns (uint256)",
  "function getAccruedInterest(uint256 loanId) view returns (uint256, uint256)",
  "function getLoanPrincipal(uint256 loanId) view returns (uint256)",
]);

const MATCHER_EVENTS_FALLBACK = parseAbi([
  "event OperatorSet(address indexed agent, address indexed operator, uint256 borrowLimit, uint256 maxRateBps, uint256 expiry, uint8 onBehalfOfRestriction)",
  "event OperatorRevoked(address indexed agent, address indexed operator)",
  "event Upgraded(address indexed implementation)",
]);

const LENDING_VIEWS_FALLBACK = parseAbi([
  "function isLoanUnderwater(uint256 loanId) view returns (bool)",
  "function getEstimatedBadDebt(uint256 loanId) view returns (uint256, bool)",
]);

export const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
]);

export const MULTICALL3_ABI = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) external view returns ((bool success, bytes returnData)[] returnData)",
]);

// -----------------------------------------------------------------------------
// Cached resolved ABIs.
// -----------------------------------------------------------------------------

export interface ResolvedAbis {
  /** Combined event ABI for decoding logs at the matcher proxy address.
   *  Includes matcher-native events + LogicsManager events that surface
   *  via delegatecall + HookExecutor events fetched from its impl. */
  matcherDecodeAbi: AbiEvent[];
  /** Function ABI for matcher view reads. */
  matcherViews: Abi;
  /** lendingViews ABI subset we use for hydration. */
  lendingViewsAbi: Abi;
  /** Source breakdown for logging. */
  sources: Record<string, "sourcify-impl" | "sourcify-direct" | "fallback">;
}

let cache: ResolvedAbis | null = null;

export async function getResolvedAbis(client: MinimalReadClient): Promise<ResolvedAbis> {
  if (cache) return cache;

  const sources: ResolvedAbis["sources"] = {};

  const matcherAbi = await resolveContractAbi(client, CONTRACTS.matcher);
  if (matcherAbi) sources.matcher = "sourcify-impl";

  const logicsManagerAbi = await fetchSourcifyAbi(CONTRACTS.logicsManager);
  if (logicsManagerAbi) sources.logicsManager = "sourcify-direct";

  const hookExecutorAbi = await resolveContractAbi(client, CONTRACTS.hookExecutor);
  if (hookExecutorAbi) sources.hookExecutor = "sourcify-impl";

  const lendingViewsAbi = await resolveContractAbi(client, CONTRACTS.lendingViews);
  if (lendingViewsAbi) sources.lendingViews = "sourcify-impl";

  const events: AbiEvent[] = [];
  for (const abi of [matcherAbi, logicsManagerAbi, hookExecutorAbi]) {
    if (!abi) continue;
    for (const item of abi) {
      if ("type" in item && item.type === "event") events.push(item as AbiEvent);
    }
  }
  if (events.length === 0) {
    events.push(...(MATCHER_EVENTS_FALLBACK as unknown as AbiEvent[]));
    sources.matcher = sources.matcher ?? "fallback";
  }

  cache = {
    matcherDecodeAbi: events,
    matcherViews: matcherAbi ?? (MATCHER_VIEWS_FALLBACK as unknown as Abi),
    lendingViewsAbi: lendingViewsAbi ?? (LENDING_VIEWS_FALLBACK as unknown as Abi),
    sources,
  };

  if (!matcherAbi) sources.matcher = "fallback";
  if (!lendingViewsAbi) sources.lendingViews = "fallback";

  return cache;
}
