import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for the Floe dashboard indexer.
 *
 * The DB is a strict projection of Base mainnet chain state. Indexer
 * writes from chain events + multicall view reads; web app only reads.
 * Reset at any time → re-bootstrap from chain (state.lastBlock = 0).
 */

export const loanStateEnum = pgEnum("loan_state", [
  "pending", // intent posted but not matched
  "active", // matched, principal outstanding
  "repaid",
  "liquidated",
  "expired",
]);

/**
 * The two markets currently live on Floe (USDC/WETH, USDC/cbBTC).
 * Refreshed from `GET /v1/markets` on a low cadence; can be considered
 * static for the dashboard's lifetime.
 */
export const markets = pgTable("markets", {
  marketId: text("market_id").primaryKey(),
  loanTokenAddress: text("loan_token_address").notNull(),
  loanTokenSymbol: text("loan_token_symbol").notNull(),
  loanTokenDecimals: integer("loan_token_decimals").notNull(),
  collateralTokenAddress: text("collateral_token_address").notNull(),
  collateralTokenSymbol: text("collateral_token_symbol").notNull(),
  collateralTokenDecimals: integer("collateral_token_decimals").notNull(),
  isActive: boolean("is_active").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Loans — the core table. One row per loanId we've ever seen on chain
 * (active and historical). Raw amounts as numeric(78,0) to fit any
 * uint256 without precision loss; the app converts to bigint at read
 * time.
 */
export const loans = pgTable(
  "loans",
  {
    loanId: text("loan_id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.marketId),
    borrower: text("borrower").notNull(),
    lender: text("lender").notNull(),
    loanToken: text("loan_token").notNull(),
    collateralToken: text("collateral_token").notNull(),

    // Raw on-chain amounts (uint256, decimal-string serializable)
    principalRaw: numeric("principal_raw", { precision: 78, scale: 0 }).notNull(),
    collateralAmountRaw: numeric("collateral_amount_raw", {
      precision: 78,
      scale: 0,
    }).notNull(),
    accruedInterestRaw: numeric("accrued_interest_raw", { precision: 78, scale: 0 }),

    // Rates / LTVs in bps
    interestRateBps: integer("interest_rate_bps").notNull(),
    ltvBps: integer("ltv_bps").notNull(), // initial LTV at origination
    liquidationLtvBps: integer("liquidation_ltv_bps").notNull(),
    currentLtvBps: integer("current_ltv_bps"), // populated by hydration

    // Other constants from getLoan()
    marketFeeBps: integer("market_fee_bps").notNull(),
    matcherCommissionBps: integer("matcher_commission_bps").notNull(),
    minInterestBps: integer("min_interest_bps").notNull(),
    gracePeriod: integer("grace_period").notNull(), // seconds

    // Lifecycle
    startTime: bigint("start_time", { mode: "bigint" }).notNull(), // unix
    duration: bigint("duration", { mode: "bigint" }).notNull(), // seconds
    state: loanStateEnum("state").notNull(),

    // Facilitator / agent flow
    operator: text("operator"), // 0x0 if not facilitator-operated
    isUnderwater: boolean("is_underwater"), // hydrated from lendingViews

    // Indexer bookkeeping
    createdAtBlock: bigint("created_at_block", { mode: "bigint" }).notNull(),
    lastEventBlock: bigint("last_event_block", { mode: "bigint" }).notNull(),
    lastHydratedAt: timestamp("last_hydrated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byMarket: index("loans_by_market_idx").on(t.marketId),
    byBorrower: index("loans_by_borrower_idx").on(t.borrower),
    byLender: index("loans_by_lender_idx").on(t.lender),
    byState: index("loans_by_state_idx").on(t.state),
    byCollateral: index("loans_by_collateral_idx").on(t.collateralToken),
  }),
);

/**
 * Raw event audit log. Every relevant chain event we see, persisted as-is.
 * Supports replay, debugging, and the loan-detail timeline view.
 */
export const events = pgTable(
  "events",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: bigint("block_timestamp", { mode: "bigint" }).notNull(),
    contractAddress: text("contract_address").notNull(),
    eventName: text("event_name").notNull(),
    loanId: text("loan_id"), // nullable — config events have no loanId
    args: jsonb("args").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.txHash, t.logIndex] }),
    byLoan: index("events_by_loan_idx").on(t.loanId),
    byBlock: index("events_by_block_idx").on(t.blockNumber),
    byEvent: index("events_by_event_idx").on(t.eventName),
  }),
);

/**
 * Indexer state — one row, key/value style. Stores `lastBlock` and
 * any other resumable bookkeeping the indexer needs across restarts.
 */
export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Latest oracle round per asset. Updated whenever Chainlink emits
 * AnswerUpdated. Used to compute USD-denominated TVL and run the
 * stress simulator.
 */
export const oracles = pgTable("oracles", {
  feedAddress: text("feed_address").primaryKey(),
  description: text("description").notNull(), // "ETH / USD"
  decimals: integer("decimals").notNull(),
  latestRoundId: text("latest_round_id").notNull(), // packed; store as decimal string
  latestAnswer: numeric("latest_answer", { precision: 78, scale: 0 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  observedAtBlock: bigint("observed_at_block", { mode: "bigint" }).notNull(),
});

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type IndexerStateRow = typeof indexerState.$inferSelect;
export type Oracle = typeof oracles.$inferSelect;
