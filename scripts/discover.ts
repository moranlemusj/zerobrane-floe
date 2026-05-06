/**
 * Phase 1b discovery script.
 *
 * Pulls everything we need to know before we start building the indexer:
 *  1. Matcher contract ABI (events + view methods).
 *  2. lendingViews contract ABI (batch reads, if any).
 *  3. A real loan ID via getLogs on the matcher, then probe Floe's
 *     /v1/credit/status/:id with a real ID to lock down its response shape.
 *  4. Chainlink price-feed addresses on Base for ETH/USD and BTC/USD,
 *     verified by reading description() + decimals() + latestRoundData().
 *
 * Output goes to /tmp/floe-discovery.json so we can paste shapes into the
 * @floe-agents/core type definitions afterward.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env scripts/discover.ts
 */

import { writeFileSync } from "node:fs";
import {
  type Abi,
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  type Log,
} from "viem";
import { base } from "viem/chains";

const MATCHER = getAddress("0x17946cD3e180f82e632805e5549EC913330Bb175");
const LENDING_VIEWS = getAddress("0x9101027166bE205105a9E0c68d6F14f21f6c5003");

// Chainlink price feeds on Base mainnet. Verified live on-chain below.
const CHAINLINK_CANDIDATES: Record<string, `0x${string}`> = {
  "ETH/USD": getAddress("0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70"),
  "BTC/USD": getAddress("0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f"),
};

const BASE_RPC =
  process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const FLOE_API = "https://credit-api.floelabs.xyz";
const FLOE_KEY = process.env.FLOE_LIVE_API_KEY;
if (!FLOE_KEY) {
  console.warn("[discover] FLOE_LIVE_API_KEY not set — REST probes will be skipped.");
}

const client = createPublicClient({ chain: base, transport: http(BASE_RPC) });

type AbiEntry = {
  type: string;
  name?: string;
  inputs?: { name: string; type: string; indexed?: boolean }[];
  outputs?: { name: string; type: string }[];
  stateMutability?: string;
};

interface DiscoveryReport {
  matcher: {
    address: string;
    abiSource: "etherscan-v2" | "sourcify" | "unavailable";
    events: AbiEntry[];
    viewMethods: AbiEntry[];
    writeMethods: AbiEntry[];
    abiTotal: number;
  };
  lendingViews: {
    address: string;
    abiSource: "etherscan-v2" | "sourcify" | "unavailable";
    viewMethods: AbiEntry[];
    abiTotal: number;
  };
  recentLogs: {
    fromBlock: string;
    toBlock: string;
    count: number;
    sample: { txHash: string; blockNumber: string; topic0: string }[];
  };
  realLoanId?: string;
  loanStatus?: unknown;
  chainlink: Record<string, {
    address: string;
    description: string;
    decimals: number;
    latestRoundId: string;
    latestAnswer: string;
    updatedAt: string;
    works: boolean;
    error?: string;
  }>;
  errors: string[];
}

const report: DiscoveryReport = {
  matcher: {
    address: MATCHER,
    abiSource: "unavailable",
    events: [],
    viewMethods: [],
    writeMethods: [],
    abiTotal: 0,
  },
  lendingViews: {
    address: LENDING_VIEWS,
    abiSource: "unavailable",
    viewMethods: [],
    abiTotal: 0,
  },
  recentLogs: { fromBlock: "0", toBlock: "0", count: 0, sample: [] },
  chainlink: {},
  errors: [],
};

// EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

async function readImplementation(proxy: `0x${string}`): Promise<`0x${string}` | null> {
  try {
    const slot = await client.getStorageAt({
      address: proxy,
      slot: EIP1967_IMPL_SLOT,
    });
    if (!slot || slot === "0x" || /^0x0+$/.test(slot)) return null;
    // Slot is a 32-byte word; address is the last 20 bytes.
    const addr = `0x${slot.slice(-40)}`.toLowerCase() as `0x${string}`;
    if (/^0x0+$/.test(addr)) return null;
    return getAddress(addr);
  } catch {
    return null;
  }
}

async function resolveAbi(
  address: `0x${string}`,
  label: string,
): Promise<{
  abi: Abi;
  source: "etherscan-v2" | "sourcify";
  implementation?: `0x${string}`;
} | null> {
  const direct = await fetchAbi(address);
  if (direct) {
    // Detect proxy by tiny ABI with only Upgraded event.
    const isProxy =
      direct.abi.length <= 10 &&
      direct.abi.some(
        (e: any) => e.type === "event" && e.name === "Upgraded",
      );
    if (isProxy) {
      console.log(`  [${label}] ${address} is an EIP-1967 proxy; resolving impl...`);
      const impl = await readImplementation(address);
      if (impl) {
        console.log(`  [${label}] implementation = ${impl}`);
        const implAbi = await fetchAbi(impl);
        if (implAbi) return { ...implAbi, implementation: impl };
        console.warn(`  [${label}] could not fetch impl ABI from Sourcify/Etherscan`);
      } else {
        console.warn(`  [${label}] could not read EIP-1967 impl slot`);
      }
    }
    return direct;
  }
  return null;
}

async function fetchAbi(
  address: string,
): Promise<{ abi: Abi; source: "etherscan-v2" | "sourcify" } | null> {
  // 1. Etherscan v2 (chainid=8453 for Base) — needs an API key now.
  const key = process.env.ETHERSCAN_API_KEY;
  if (key) {
    const v2 = `https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getabi&address=${address}&apikey=${key}`;
    try {
      const res = await fetch(v2);
      const json = (await res.json()) as { status: string; result: string };
      if (json.status === "1") {
        return { abi: JSON.parse(json.result) as Abi, source: "etherscan-v2" };
      }
      console.warn(`[discover] etherscan-v2: ${json.result}`);
    } catch (e) {
      console.warn(`[discover] etherscan-v2 threw: ${(e as Error).message}`);
    }
  }
  // 2. Sourcify — public, no key. Tries full_match then partial_match.
  for (const matchType of ["full_match", "partial_match"] as const) {
    const url = `https://repo.sourcify.dev/contracts/${matchType}/8453/${address}/metadata.json`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const meta = (await res.json()) as { output?: { abi?: Abi } };
        if (meta.output?.abi) {
          return { abi: meta.output.abi, source: "sourcify" };
        }
      }
    } catch {
      // fall through
    }
  }
  return null;
}

function partition(abi: Abi) {
  const events: AbiEntry[] = [];
  const viewMethods: AbiEntry[] = [];
  const writeMethods: AbiEntry[] = [];
  for (const entry of abi as AbiEntry[]) {
    if (entry.type === "event") events.push(entry);
    else if (entry.type === "function") {
      if (entry.stateMutability === "view" || entry.stateMutability === "pure") {
        viewMethods.push(entry);
      } else {
        writeMethods.push(entry);
      }
    }
  }
  return { events, viewMethods, writeMethods };
}

async function step1MatcherAbi() {
  console.log(`\n=== Step 1: Matcher ABI ${MATCHER} ===`);
  const result = await resolveAbi(MATCHER, "matcher");
  if (!result) {
    report.errors.push(`Could not fetch matcher ABI for ${MATCHER}`);
    return;
  }
  const { abi, source } = result;
  if (result.implementation) {
    (report.matcher as { implementation?: string }).implementation = result.implementation;
  }
  const { events, viewMethods, writeMethods } = partition(abi);
  report.matcher = {
    address: MATCHER,
    abiSource: source,
    abiTotal: abi.length,
    events,
    viewMethods,
    writeMethods,
  };
  console.log(`Source: ${source}`);
  console.log(`Total ABI entries: ${abi.length}`);
  console.log(`Events: ${events.length} → ${events.map((e) => e.name).join(", ")}`);
  console.log(
    `View methods: ${viewMethods.length} → ${viewMethods
      .map((m) => m.name)
      .slice(0, 30)
      .join(", ")}${viewMethods.length > 30 ? "…" : ""}`,
  );
  console.log(
    `Write methods: ${writeMethods.length} → ${writeMethods
      .map((m) => m.name)
      .slice(0, 30)
      .join(", ")}${writeMethods.length > 30 ? "…" : ""}`,
  );
}

async function step2ViewsAbi() {
  console.log(`\n=== Step 2: lendingViews ABI ${LENDING_VIEWS} ===`);
  const result = await resolveAbi(LENDING_VIEWS, "lendingViews");
  if (!result) {
    report.errors.push(`Could not fetch lendingViews ABI for ${LENDING_VIEWS}`);
    return;
  }
  const { abi, source } = result;
  if (result.implementation) {
    (report.lendingViews as { implementation?: string }).implementation = result.implementation;
  }
  const { viewMethods } = partition(abi);
  report.lendingViews = {
    address: LENDING_VIEWS,
    abiSource: source,
    abiTotal: abi.length,
    viewMethods,
  };
  console.log(`Source: ${source}`);
  console.log(`Total ABI entries: ${abi.length}`);
  console.log(`View methods (${viewMethods.length}):`);
  for (const m of viewMethods) {
    const inputs = (m.inputs ?? []).map((i) => `${i.type} ${i.name}`).join(", ");
    const outputs = (m.outputs ?? []).map((o) => o.type).join(", ");
    console.log(`  ${m.name}(${inputs}) → ${outputs}`);
  }
}

async function step2bResolveCompanionContracts() {
  console.log(`\n=== Step 2b: companion contracts via matcher views ===`);
  if (report.matcher.viewMethods.length === 0) {
    console.log(`  No matcher view ABI; skipping.`);
    return;
  }
  const matcherImpl = (report.matcher as { implementation?: `0x${string}` }).implementation;
  const callTarget = MATCHER; // proxy is the call target — delegatecall handles the rest
  void matcherImpl;
  const matcherAbi = [
    ...report.matcher.events,
    ...report.matcher.viewMethods,
    ...report.matcher.writeMethods,
  ] as unknown as Abi;

  const probes = [
    "getHookExecutor",
    "getLogicsManager",
    "getPriceOracle",
    "getFeeRecipient",
    "getMaxGracePeriod",
    "getMinGracePeriod",
    "getMaxLoanDuration",
  ] as const;
  const results: Record<string, unknown> = {};
  for (const fn of probes) {
    try {
      const r = await client.readContract({
        address: callTarget,
        abi: matcherAbi,
        functionName: fn,
      });
      results[fn] = typeof r === "bigint" ? r.toString() : r;
      console.log(`  ${fn}() = ${results[fn]}`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      console.log(`  ${fn}() ❌ ${msg}`);
    }
  }
  (report as { matcherViews?: Record<string, unknown> }).matcherViews = results;

  // Resolve hook executor + logics manager ABIs (likely the contracts emitting loan events).
  const companions: Record<string, { address: string; abi?: AbiEntry[]; events?: AbiEntry[] }> = {};
  for (const fn of ["getHookExecutor", "getLogicsManager"] as const) {
    const addr = results[fn];
    if (typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr) && !/^0x0+$/.test(addr)) {
      const checksummed = getAddress(addr);
      console.log(`  Resolving ${fn} contract at ${checksummed}...`);
      const resolved = await resolveAbi(checksummed, fn);
      if (resolved) {
        const part = partition(resolved.abi);
        companions[fn] = {
          address: checksummed,
          events: part.events,
        };
        console.log(
          `    ${resolved.source}: ${part.events.length} events → ${part.events.map((e) => e.name).join(", ")}`,
        );
      } else {
        companions[fn] = { address: checksummed };
        console.log(`    Could not fetch ABI`);
      }
    }
  }
  (report as { companions?: typeof companions }).companions = companions;
}

async function step3FindRealLoanId() {
  console.log(`\n=== Step 3: Recent matcher logs → find a real loan ID ===`);
  const head = await client.getBlockNumber();
  const lookback = 100_000n; // ~55 hours on Base (2s blocks)
  const fromBlock = head - lookback;
  console.log(`Fetching logs from block ${fromBlock} to ${head} (~${(Number(lookback) * 2) / 3600}h)`);
  // Public Base RPC limits getLogs to 10k blocks; chunk to be safe.
  const CHUNK = 9_500n;
  const logs: Log[] = [];
  try {
    for (let from = fromBlock; from <= head; from += CHUNK + 1n) {
      const to = from + CHUNK > head ? head : from + CHUNK;
      const chunk = await client.getLogs({
        address: MATCHER,
        fromBlock: from,
        toBlock: to,
      });
      logs.push(...chunk);
    }
  } catch (e) {
    report.errors.push(`getLogs failed: ${(e as Error).message}`);
    console.error(`  getLogs failed: ${(e as Error).message}`);
    return;
  }
  console.log(`Got ${logs.length} raw logs across the window`);
  report.recentLogs = {
    fromBlock: fromBlock.toString(),
    toBlock: head.toString(),
    count: logs.length,
    sample: logs.slice(0, 5).map((l) => ({
      txHash: l.transactionHash ?? "",
      blockNumber: l.blockNumber?.toString() ?? "",
      topic0: l.topics[0] ?? "",
    })),
  };

  // Try to decode against the fetched ABI, just to identify what kind of events they are.
  if (report.matcher.events.length === 0) {
    console.log("  No matcher ABI events to decode against — skipping decode step.");
    return;
  }

  const matcherAbi = [...report.matcher.events] as unknown as Abi;
  console.log(`  Decoding ${logs.length} matcher logs against matcher ABI:`);
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: matcherAbi,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: Record<string, unknown> };
      const argsSummary = JSON.stringify(decoded.args, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ).slice(0, 200);
      console.log(`    block=${log.blockNumber} ${decoded.eventName} ${argsSummary}`);
    } catch {
      console.log(`    block=${log.blockNumber} (undecoded) topic0=${log.topics[0]?.slice(0, 12)}…`);
    }
  }

  // Try sequential getLoan(id) to find an existing loan.
  // loanId 0 returns the zero sentinel (all addresses 0x0, all amounts 0); loans are 1-indexed.
  const matcherFullAbi = [
    ...report.matcher.events,
    ...report.matcher.viewMethods,
    ...report.matcher.writeMethods,
  ] as unknown as Abi;
  console.log(`  Probing getLoan(id) for IDs 1..50 to find a real loan...`);
  for (let id = 1n; id < 50n; id++) {
    try {
      const loan = (await client.readContract({
        address: MATCHER,
        abi: matcherFullAbi,
        functionName: "getLoan",
        args: [id],
      })) as Record<string, unknown>;
      // Reject zero sentinels: loanId=0n or all-zero borrower means "doesn't exist".
      const borrower = loan.borrower as string | undefined;
      if (borrower && borrower !== "0x0000000000000000000000000000000000000000") {
        report.realLoanId = id.toString();
        console.log(`  ✅ Found loanId=${id} via getLoan(); shape:`);
        const loanJson = JSON.stringify(
          loan,
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
          2,
        );
        console.log(loanJson.slice(0, 2500));
        (report as { loanShape?: unknown; loanRaw?: unknown }).loanRaw = JSON.parse(loanJson);

        // Also call the rich view methods that we know exist.
        for (const fn of ["getLoanPrincipal", "getAccruedInterest", "getCurrentLtvBps"] as const) {
          try {
            const r = (await client.readContract({
              address: MATCHER,
              abi: matcherFullAbi,
              functionName: fn,
              args: [id],
            })) as bigint;
            console.log(`  ${fn}(${id}) = ${r}`);
          } catch (e) {
            console.log(`  ${fn}(${id}) ❌ ${(e as Error).message.split("\n")[0]}`);
          }
        }
        return;
      }
    } catch {
      // continue
    }
  }
  console.log(`  No real loan in IDs 1..49.`);
}

async function step3cLogicsManagerLogs() {
  console.log(`\n=== Step 3c: LogicsManager + HookExecutor logs ===`);
  const companions =
    (report as { companions?: Record<string, { address: string; events?: AbiEntry[] }> })
      .companions ?? {};
  const lm = companions.getLogicsManager;
  const he = companions.getHookExecutor;
  const head = await client.getBlockNumber();
  const lookback = 100_000n;
  const fromBlock = head - lookback;
  const CHUNK = 9_500n;

  for (const [label, info] of [
    ["LogicsManager", lm],
    ["HookExecutor", he],
  ] as const) {
    if (!info) continue;
    const addr = info.address as `0x${string}`;
    const logs: Log[] = [];
    try {
      for (let from = fromBlock; from <= head; from += CHUNK + 1n) {
        const to = from + CHUNK > head ? head : from + CHUNK;
        const chunk = await client.getLogs({
          address: addr,
          fromBlock: from,
          toBlock: to,
        });
        logs.push(...chunk);
      }
    } catch (e) {
      console.log(`  [${label}] getLogs failed: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    console.log(`  [${label}] ${addr}: ${logs.length} logs in last ~55h`);
    if (info.events && logs.length > 0) {
      const abi = info.events as unknown as Abi;
      for (const log of logs.slice(0, 6)) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as {
            eventName: string;
            args: Record<string, unknown>;
          };
          const argsSummary = JSON.stringify(decoded.args, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ).slice(0, 240);
          console.log(`    ${decoded.eventName} ${argsSummary}`);
        } catch {
          console.log(`    (undecoded) topic0=${log.topics[0]?.slice(0, 12)}…`);
        }
      }
    }
  }
}

async function step3bProbeLoanStatus() {
  if (!report.realLoanId || !FLOE_KEY) return;
  console.log(`\n=== Step 3b: GET /v1/credit/status/${report.realLoanId} (with API key) ===`);
  try {
    const res = await fetch(`${FLOE_API}/v1/credit/status/${report.realLoanId}`, {
      headers: { Authorization: `Bearer ${FLOE_KEY}` },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    console.log(`HTTP ${res.status}`);
    console.log(JSON.stringify(body, null, 2).slice(0, 3000));
    if (res.ok) report.loanStatus = body;
    else report.errors.push(`getLoanStatus(${report.realLoanId}) → ${res.status}: ${text}`);
  } catch (e) {
    report.errors.push(`getLoanStatus probe threw: ${(e as Error).message}`);
  }
}

async function step4ChainlinkFeeds() {
  console.log(`\n=== Step 4: Chainlink price-feed verification ===`);
  const feedAbi = parseAbi([
    "function description() view returns (string)",
    "function decimals() view returns (uint8)",
    "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
    "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
  ]);
  const retry = async <T>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
    throw lastErr;
  };
  for (const [label, address] of Object.entries(CHAINLINK_CANDIDATES)) {
    try {
      const description = (await retry(() =>
        client.readContract({ address, abi: feedAbi, functionName: "description" }),
      )) as string;
      const decimals = (await retry(() =>
        client.readContract({ address, abi: feedAbi, functionName: "decimals" }),
      )) as number;
      const round = (await retry(() =>
        client.readContract({ address, abi: feedAbi, functionName: "latestRoundData" }),
      )) as [bigint, bigint, bigint, bigint, bigint];
      report.chainlink[label] = {
        address,
        description,
        decimals,
        latestRoundId: round[0].toString(),
        latestAnswer: round[1].toString(),
        updatedAt: round[3].toString(),
        works: true,
      };
      const human =
        Number(round[1]) / 10 ** decimals;
      console.log(
        `  ${label.padEnd(10)} ${address}  "${description}"  $${human.toFixed(2)}  round=${round[0]}`,
      );
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      report.chainlink[label] = {
        address,
        description: "",
        decimals: 0,
        latestRoundId: "0",
        latestAnswer: "0",
        updatedAt: "0",
        works: false,
        error: msg,
      };
      console.log(`  ${label.padEnd(10)} ${address}  ❌ ${msg}`);
    }
  }
}

async function main() {
  await step1MatcherAbi();
  await step2ViewsAbi();
  await step2bResolveCompanionContracts();
  await step3FindRealLoanId();
  await step3bProbeLoanStatus();
  await step3cLogicsManagerLogs();
  await step4ChainlinkFeeds();

  writeFileSync(
    "/tmp/floe-discovery.json",
    JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
    "utf8",
  );
  console.log(`\n=== Report ===`);
  console.log(`Wrote /tmp/floe-discovery.json (${JSON.stringify(report).length} bytes)`);
  console.log(`Errors: ${report.errors.length}`);
  for (const err of report.errors) console.log(`  - ${err}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
