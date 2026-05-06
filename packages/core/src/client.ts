import { type AuthContext, type AuthMode, buildAuthHeaders } from "./auth.js";
import { bpsToNumber, numberToInt, rawToUsdc, rawToUsdcNullable, usdcToRaw } from "./coerce.js";
import type {
  AgentBalance,
  CreditOffer,
  CreditOffersResponse,
  CreditRemaining,
  CreditThreshold,
  InstantBorrowParams,
  InstantBorrowResult,
  LoanState,
  LoanStateName,
  Market,
  MarketsResponse,
  PreRegisterResult,
  ProxyCheckResult,
  ProxyFetchResult,
  RegisterResult,
  SpendLimit,
  UnsignedTx,
  UsdcAmount,
  X402CostEstimate,
} from "./types.js";

const DEFAULT_BASE_URL = "https://credit-api.floelabs.xyz";

export interface FloeClientOptions extends AuthContext {
  baseUrl?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export class FloeClientError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: string;
  readonly body?: unknown;
  constructor(opts: {
    message: string;
    status: number;
    path: string;
    method: string;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "FloeClientError";
    this.status = opts.status;
    this.path = opts.path;
    this.method = opts.method;
    this.body = opts.body;
  }
}

export interface FloeClient {
  // Agent awareness — primary binding hot path
  getCreditRemaining(): Promise<CreditRemaining>;
  getLoanState(): Promise<LoanState>;
  getSpendLimit(): Promise<SpendLimit | null>;
  setSpendLimit(opts: { limit: UsdcAmount }): Promise<SpendLimit>;
  clearSpendLimit(): Promise<void>;

  // x402 — preflight + facilitator-proxied paid HTTP
  estimateX402Cost(opts: { url: string; method?: string }): Promise<X402CostEstimate>;
  proxyCheck(url: string): Promise<ProxyCheckResult>;
  proxyFetch(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<ProxyFetchResult>;

  // Credit thresholds (webhook triggers)
  listCreditThresholds(): Promise<CreditThreshold[]>;
  registerCreditThreshold(opts: {
    thresholdBps: number;
    webhookId: number;
  }): Promise<CreditThreshold>;
  deleteCreditThreshold(id: string): Promise<void>;

  // Agent lifecycle
  preRegisterAgent(opts: {
    collateralToken: string;
    borrowLimit: UsdcAmount;
    maxRateBps: number;
  }): Promise<PreRegisterResult>;
  registerAgent(opts: { delegationTxHash: string }): Promise<RegisterResult>;
  getAgentBalance(): Promise<AgentBalance>;
  getAgentTransactions(query?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ items: unknown[]; nextCursor?: string }>;
  closeAgent(): Promise<{
    status: string;
    loansRepaid: number;
    loansRemaining: number;
    usdcTransferred: UsdcAmount;
  }>;

  // Protocol-level credit operations (returns unsigned txs; for non-agent users)
  instantBorrow(params: InstantBorrowParams): Promise<InstantBorrowResult>;
  repayLoan(opts: { loanId: string; slippageBps: number }): Promise<{ transactions: UnsignedTx[] }>;
  repayAndReborrow(
    params: InstantBorrowParams & { loanId: string },
  ): Promise<{ repayTransactions: UnsignedTx[]; reborrowTransactions: UnsignedTx[] }>;
  /**
   * Per-loan rich detail (LTV, buffer, accruedInterest, isHealthy, ...).
   *
   * Returns `unknown` because the live shape couldn't be verified against our
   * developer Bearer key on 2026-05-06 — the endpoint returned 401 "Invalid
   * API key" even for verified-real loan IDs, suggesting it requires
   * wallet-signature auth or full agent registration. If your key has those,
   * cast the response to your local type.
   */
  getLoanStatus(loanId: string): Promise<unknown>;
  /**
   * Per-wallet positions + summary.
   *
   * Returns `unknown` because the live endpoint returned **500 Internal
   * Server Error** for every wallet we tried on 2026-05-06 (Floe-side bug,
   * not auth). Once Floe's API is fixed, type the response based on the
   * shape documented at https://floe-labs.gitbook.io/docs/developers/credit-api.
   */
  getPositions(
    wallet: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown>;

  // Borrow attempts
  getBorrowAttempt(attemptId: string): Promise<unknown>;
  resumeBorrowAttempt(attemptId: string): Promise<{ transactions: UnsignedTx[] }>;
  abandonBorrowAttempt(attemptId: string): Promise<{ transactions: UnsignedTx[] }>;

  // Tx broadcasting
  broadcastTx(opts: {
    signedTransactionHex: string;
    attemptId?: string;
    phase?: string;
  }): Promise<{ txHash: string; receipt?: unknown }>;

  // Public (no auth)
  /** Returns the catalog of supported lending pairs. Verified shape (2026-05-06). */
  getMarkets(): Promise<MarketsResponse>;
  /** Returns open lender offers, optionally filtered. Verified shape (2026-05-06). */
  getCreditOffers(query?: {
    marketId?: string;
    minAmount?: UsdcAmount;
    maxRateBps?: number;
    maxResults?: number;
  }): Promise<CreditOffersResponse>;
  getCostOfCapital(
    marketId: string,
    query: { borrowAmount: UsdcAmount; duration: number },
  ): Promise<unknown>;
  getHealth(): Promise<{ status: string; timestamp: string }>;
}

interface RequestOpts {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  authMode?: AuthMode;
  headers?: Record<string, string>;
}

export function createFloeClient(opts: FloeClientOptions = {}): FloeClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("FloeClient: no fetch available. Pass `fetch` in options on Node <18.");
  }
  const ctx: AuthContext = {
    apiKey: opts.apiKey,
    walletAddress: opts.walletAddress,
    walletSigner: opts.walletSigner,
  };

  async function request<T>(req: RequestOpts): Promise<T> {
    const url = buildUrl(baseUrl, req.path, req.query);
    const auth = await buildAuthHeaders(ctx, req.authMode);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.defaultHeaders ?? {}),
      ...auth,
      ...(req.headers ?? {}),
    };
    const init: RequestInit = { method: req.method, headers };
    if (req.body !== undefined) init.body = JSON.stringify(req.body);

    const res = await fetchImpl(url, init);
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const message = extractErrorMessage(parsed) ?? `Floe ${req.method} ${req.path} failed: ${res.status}`;
      throw new FloeClientError({
        message,
        status: res.status,
        path: req.path,
        method: req.method,
        body: parsed,
      });
    }
    return parsed as T;
  }

  return {
    async getCreditRemaining() {
      const r = await request<RawCreditRemaining>({
        method: "GET",
        path: "/v1/agents/credit-remaining",
      });
      return parseCreditRemaining(r);
    },

    async getLoanState() {
      const r = await request<RawLoanState>({ method: "GET", path: "/v1/agents/loan-state" });
      return parseLoanState(r);
    },

    async getSpendLimit() {
      const r = await request<RawSpendLimit | null>({
        method: "GET",
        path: "/v1/agents/spend-limit",
      });
      return r ? parseSpendLimit(r) : null;
    },

    async setSpendLimit({ limit }) {
      const r = await request<RawSpendLimit>({
        method: "PUT",
        path: "/v1/agents/spend-limit",
        body: { limitRaw: usdcToRaw(limit) },
      });
      return parseSpendLimit(r);
    },

    async clearSpendLimit() {
      await request<void>({ method: "DELETE", path: "/v1/agents/spend-limit" });
    },

    async estimateX402Cost({ url, method = "GET" }) {
      const r = await request<RawX402Estimate>({
        method: "POST",
        path: "/v1/x402/estimate",
        body: { url, method },
      });
      return parseX402Estimate(r);
    },

    async proxyCheck(url) {
      const r = await request<RawProxyCheck>({
        method: "GET",
        path: "/v1/proxy/check",
        query: { url },
        authMode: "public",
      });
      return parseProxyCheck(r);
    },

    async proxyFetch(opts) {
      return await request<ProxyFetchResult>({
        method: "POST",
        path: "/v1/proxy/fetch",
        body: {
          url: opts.url,
          method: opts.method ?? "GET",
          headers: opts.headers,
          body: opts.body,
        },
      });
    },

    async listCreditThresholds() {
      const r = await request<{ thresholds: RawCreditThreshold[] } | RawCreditThreshold[]>({
        method: "GET",
        path: "/v1/agents/credit-thresholds",
      });
      const list = Array.isArray(r) ? r : r.thresholds;
      return list.map(parseCreditThreshold);
    },

    async registerCreditThreshold({ thresholdBps, webhookId }) {
      const r = await request<RawCreditThreshold>({
        method: "POST",
        path: "/v1/agents/credit-thresholds",
        body: { thresholdBps, webhookId },
      });
      return parseCreditThreshold(r);
    },

    async deleteCreditThreshold(id) {
      await request<void>({
        method: "DELETE",
        path: `/v1/agents/credit-thresholds/${encodeURIComponent(id)}`,
      });
    },

    async preRegisterAgent({ collateralToken, borrowLimit, maxRateBps }) {
      return await request<PreRegisterResult>({
        method: "POST",
        path: "/v1/agents/pre-register",
        body: {
          collateralToken,
          borrowLimit: usdcToRaw(borrowLimit),
          maxRateBps: maxRateBps.toString(),
        },
      });
    },

    async registerAgent({ delegationTxHash }) {
      const r = await request<RawRegisterResult>({
        method: "POST",
        path: "/v1/agents/register",
        body: { delegationTxHash },
      });
      return {
        status: r.status,
        apiKey: r.apiKey,
        creditLimit: rawToUsdc(r.creditLimit),
        paymentWalletAddress: r.paymentWalletAddress,
      };
    },

    async getAgentBalance() {
      const r = await request<RawAgentBalance>({ method: "GET", path: "/v1/agents/balance" });
      return parseAgentBalance(r);
    },

    async getAgentTransactions(query) {
      return await request<{ items: unknown[]; nextCursor?: string }>({
        method: "GET",
        path: "/v1/agents/transactions",
        query: query ? { limit: query.limit, cursor: query.cursor } : undefined,
      });
    },

    async closeAgent() {
      const r = await request<{
        status: string;
        loansRepaid: number;
        loansRemaining: number;
        usdcTransferred: string;
      }>({ method: "POST", path: "/v1/agents/close" });
      return {
        status: r.status,
        loansRepaid: r.loansRepaid,
        loansRemaining: r.loansRemaining,
        usdcTransferred: rawToUsdc(r.usdcTransferred),
      };
    },

    async instantBorrow(params) {
      const headers = params.idempotencyKey
        ? { "Idempotency-Key": params.idempotencyKey }
        : undefined;
      const r = await request<RawInstantBorrowResult>({
        method: "POST",
        path: "/v1/credit/instant-borrow",
        body: {
          marketId: params.marketId,
          borrowAmount: usdcToRaw(params.borrowAmount),
          collateralAmount: params.collateralAmount.toString(),
          maxInterestRateBps: params.maxInterestRateBps.toString(),
          duration: params.duration.toString(),
          minLtvBps: params.minLtvBps.toString(),
          maxLtvBps: params.maxLtvBps.toString(),
        },
        headers,
      });
      return parseInstantBorrow(r);
    },

    async repayLoan({ loanId, slippageBps }) {
      return await request<{ transactions: UnsignedTx[] }>({
        method: "POST",
        path: "/v1/credit/repay",
        body: { loanId, slippageBps: slippageBps.toString() },
      });
    },

    async repayAndReborrow(params) {
      return await request<{
        repayTransactions: UnsignedTx[];
        reborrowTransactions: UnsignedTx[];
      }>({
        method: "POST",
        path: "/v1/credit/repay-and-reborrow",
        body: {
          loanId: params.loanId,
          marketId: params.marketId,
          newBorrowAmount: usdcToRaw(params.borrowAmount),
          newCollateralAmount: params.collateralAmount.toString(),
          maxInterestRateBps: params.maxInterestRateBps.toString(),
          duration: params.duration.toString(),
        },
      });
    },

    async getLoanStatus(loanId) {
      return await request<unknown>({
        method: "GET",
        path: `/v1/credit/status/${encodeURIComponent(loanId)}`,
      });
    },

    async getPositions(wallet, query) {
      const normalizedQuery = query
        ? Object.fromEntries(
            Object.entries(query).map(([k, v]) => [k, v === undefined ? undefined : String(v)]),
          )
        : undefined;
      return await request<unknown>({
        method: "GET",
        path: `/v1/positions/${encodeURIComponent(wallet)}`,
        query: normalizedQuery,
      });
    },

    async getBorrowAttempt(attemptId) {
      return await request<unknown>({
        method: "GET",
        path: `/v1/credit/borrow-attempts/${encodeURIComponent(attemptId)}`,
      });
    },

    async resumeBorrowAttempt(attemptId) {
      return await request<{ transactions: UnsignedTx[] }>({
        method: "POST",
        path: `/v1/credit/borrow-attempts/${encodeURIComponent(attemptId)}/resume`,
      });
    },

    async abandonBorrowAttempt(attemptId) {
      return await request<{ transactions: UnsignedTx[] }>({
        method: "POST",
        path: `/v1/credit/borrow-attempts/${encodeURIComponent(attemptId)}/abandon`,
      });
    },

    async broadcastTx({ signedTransactionHex, attemptId, phase }) {
      return await request<{ txHash: string; receipt?: unknown }>({
        method: "POST",
        path: "/v1/tx/broadcast",
        body: {
          signed_transaction_hex: signedTransactionHex,
          attempt_id: attemptId,
          phase,
        },
      });
    },

    async getMarkets() {
      const r = await request<RawMarketsResponse>({
        method: "GET",
        path: "/v1/markets",
        authMode: "public",
      });
      return {
        markets: r.markets.map<Market>((m) => ({
          marketId: m.marketId,
          loanToken: m.loanToken,
          collateralToken: m.collateralToken,
          isActive: m.isActive,
        })),
      };
    },

    async getCreditOffers(query) {
      const r = await request<RawCreditOffersResponse>({
        method: "GET",
        path: "/v1/credit/offers",
        query: query
          ? {
              marketId: query.marketId,
              minAmount: query.minAmount !== undefined ? usdcToRaw(query.minAmount) : undefined,
              maxRateBps: query.maxRateBps,
              maxResults: query.maxResults,
            }
          : undefined,
        authMode: "public",
      });
      return { offers: r.offers.map(parseCreditOffer) };
    },

    async getCostOfCapital(marketId, { borrowAmount, duration }) {
      return await request<unknown>({
        method: "GET",
        path: `/v1/markets/${encodeURIComponent(marketId)}/cost-of-capital`,
        query: { borrowAmount: usdcToRaw(borrowAmount), duration },
        authMode: "public",
      });
    },

    async getHealth() {
      return await request<{ status: string; timestamp: string }>({
        method: "GET",
        path: "/v1/health",
        authMode: "public",
      });
    },
  };
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  let url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const s = params.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

function extractErrorMessage(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
  }
  if (typeof parsed === "string" && parsed.trim()) return parsed;
  return undefined;
}

// -----------------------------------------------------------------------------
// Wire shapes (decimal strings, raw oneline JSON) → typed domain objects.
// -----------------------------------------------------------------------------

interface RawCreditRemaining {
  available: string;
  creditIn: string;
  creditOut: string;
  creditLimit: string;
  headroomToAutoBorrow: string;
  utilizationBps: number;
  sessionSpendLimit: string | null;
  sessionSpent: string;
  sessionSpendRemaining: string | null;
  asOf: string;
}

function parseCreditRemaining(r: RawCreditRemaining): CreditRemaining {
  return {
    available: rawToUsdc(r.available),
    creditIn: rawToUsdc(r.creditIn),
    creditOut: rawToUsdc(r.creditOut),
    creditLimit: rawToUsdc(r.creditLimit),
    headroomToAutoBorrow: rawToUsdc(r.headroomToAutoBorrow),
    utilizationBps: r.utilizationBps,
    sessionSpendLimit: rawToUsdcNullable(r.sessionSpendLimit),
    sessionSpent: rawToUsdc(r.sessionSpent),
    sessionSpendRemaining: rawToUsdcNullable(r.sessionSpendRemaining),
    asOf: r.asOf,
  };
}

interface RawLoanState {
  state: LoanStateName;
  reason?: string;
  details?: {
    source?: string;
    status?: string;
    available?: string;
    creditLimit?: string;
  };
}

function parseLoanState(r: RawLoanState): LoanState {
  return {
    state: r.state,
    reason: r.reason,
    details: r.details
      ? {
          source: r.details.source,
          status: r.details.status,
          available:
            r.details.available !== undefined ? rawToUsdc(r.details.available) : undefined,
          creditLimit:
            r.details.creditLimit !== undefined ? rawToUsdc(r.details.creditLimit) : undefined,
        }
      : undefined,
  };
}

interface RawSpendLimit {
  active: boolean;
  limitRaw: string;
  sessionSpentRaw: string;
  sessionRemainingRaw: string;
}

function parseSpendLimit(r: RawSpendLimit): SpendLimit {
  return {
    active: r.active,
    limit: rawToUsdc(r.limitRaw),
    sessionSpent: rawToUsdc(r.sessionSpentRaw),
    sessionRemaining: rawToUsdc(r.sessionRemainingRaw),
  };
}

interface RawX402Estimate {
  url: string;
  method: string;
  x402: boolean;
  priceRaw: string;
  asset: string;
  network: string;
  payTo: string;
  scheme: string;
  cached: boolean;
  fetchedAt: string;
  reflection: {
    available: string;
    headroomToAutoBorrow: string;
    sessionSpendRemaining: string | null;
    willExceedAvailable: boolean;
    willExceedHeadroom: boolean;
    willExceedSpendLimit: boolean;
  };
}

function parseX402Estimate(r: RawX402Estimate): X402CostEstimate {
  return {
    url: r.url,
    method: r.method,
    isX402: r.x402,
    price: rawToUsdc(r.priceRaw),
    asset: r.asset,
    network: r.network,
    payTo: r.payTo,
    scheme: r.scheme,
    cached: r.cached,
    fetchedAt: r.fetchedAt,
    reflection: {
      available: rawToUsdc(r.reflection.available),
      headroomToAutoBorrow: rawToUsdc(r.reflection.headroomToAutoBorrow),
      sessionSpendRemaining: rawToUsdcNullable(r.reflection.sessionSpendRemaining),
      willExceedAvailable: r.reflection.willExceedAvailable,
      willExceedHeadroom: r.reflection.willExceedHeadroom,
      willExceedSpendLimit: r.reflection.willExceedSpendLimit,
    },
  };
}

interface RawProxyCheck {
  requiresPayment: boolean;
  price?: string;
  currency?: string;
  network?: string;
}

function parseProxyCheck(r: RawProxyCheck): ProxyCheckResult {
  return {
    requiresPayment: r.requiresPayment,
    ...(r.price !== undefined ? { price: rawToUsdc(r.price) } : {}),
    ...(r.currency !== undefined ? { currency: r.currency } : {}),
    ...(r.network !== undefined ? { network: r.network } : {}),
  };
}

interface RawCreditThreshold {
  id: string | number;
  thresholdBps: number;
  webhookId: number;
  createdAt: string;
}

function parseCreditThreshold(r: RawCreditThreshold): CreditThreshold {
  return {
    id: String(r.id),
    thresholdBps: r.thresholdBps,
    webhookId: r.webhookId,
    createdAt: r.createdAt,
  };
}

interface RawAgentBalance {
  creditLimit: string;
  creditUsed: string;
  creditAvailable: string;
  activeLoans: { loanId: string; principalRaw: string }[];
  delegationActive: boolean;
}

function parseAgentBalance(r: RawAgentBalance): AgentBalance {
  return {
    creditLimit: rawToUsdc(r.creditLimit),
    creditUsed: rawToUsdc(r.creditUsed),
    creditAvailable: rawToUsdc(r.creditAvailable),
    activeLoans: r.activeLoans.map((l) => ({
      loanId: l.loanId,
      principal: rawToUsdc(l.principalRaw),
    })),
    delegationActive: r.delegationActive,
  };
}

interface RawRegisterResult {
  status: string;
  apiKey: string;
  creditLimit: string;
  paymentWalletAddress: string;
}

interface RawInstantBorrowResult {
  attemptId: string;
  status: string;
  reused: boolean;
  transactions: UnsignedTx[];
  selectedOffer?: {
    offerHash: string;
    minInterestRateBps: string | number;
    remainingAmount: string;
  };
}

function parseInstantBorrow(r: RawInstantBorrowResult): InstantBorrowResult {
  const out: InstantBorrowResult = {
    attemptId: r.attemptId,
    status: r.status,
    reused: r.reused,
    transactions: r.transactions,
  };
  if (r.selectedOffer) {
    out.selectedOffer = {
      offerHash: r.selectedOffer.offerHash,
      minInterestRateBps:
        typeof r.selectedOffer.minInterestRateBps === "string"
          ? Number(r.selectedOffer.minInterestRateBps)
          : r.selectedOffer.minInterestRateBps,
      remainingAmount: rawToUsdc(r.selectedOffer.remainingAmount),
    };
  }
  return out;
}

interface RawMarket {
  marketId: `0x${string}`;
  loanToken: { address: `0x${string}`; symbol: string; decimals: number };
  collateralToken: { address: `0x${string}`; symbol: string; decimals: number };
  isActive: boolean;
}

interface RawMarketsResponse {
  markets: RawMarket[];
}

interface RawCreditOffer {
  offerHash: `0x${string}`;
  lender: `0x${string}`;
  onBehalfOf: `0x${string}`;
  amount: string;
  filledAmount: string;
  remainingAmount: string;
  minFillAmount: string;
  minInterestRateBps: string | number;
  maxLtvBps: string | number;
  minDuration: string | number;
  maxDuration: string | number;
  allowPartialFill: boolean;
  validFromTimestamp: string | number;
  expiry: string | number;
  marketId: `0x${string}`;
  salt: `0x${string}`;
  gracePeriod: string | number;
  minInterestBps: string | number;
}

interface RawCreditOffersResponse {
  offers: RawCreditOffer[];
}

function parseCreditOffer(r: RawCreditOffer): CreditOffer {
  return {
    offerHash: r.offerHash,
    lender: r.lender,
    onBehalfOf: r.onBehalfOf,
    amount: rawToUsdc(r.amount),
    filledAmount: rawToUsdc(r.filledAmount),
    remainingAmount: rawToUsdc(r.remainingAmount),
    minFillAmount: rawToUsdc(r.minFillAmount),
    minInterestRateBps: bpsToNumber(r.minInterestRateBps),
    maxLtvBps: bpsToNumber(r.maxLtvBps),
    minDuration: numberToInt(r.minDuration),
    maxDuration: numberToInt(r.maxDuration),
    allowPartialFill: r.allowPartialFill,
    validFromTimestamp: numberToInt(r.validFromTimestamp),
    expiry: numberToInt(r.expiry),
    marketId: r.marketId,
    salt: r.salt,
    gracePeriod: numberToInt(r.gracePeriod),
    minInterestBps: bpsToNumber(r.minInterestBps),
  };
}
