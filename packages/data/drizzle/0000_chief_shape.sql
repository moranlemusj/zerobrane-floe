CREATE TYPE "public"."loan_state" AS ENUM('pending', 'active', 'repaid', 'liquidated', 'expired');--> statement-breakpoint
CREATE TABLE "events" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint NOT NULL,
	"contract_address" text NOT NULL,
	"event_name" text NOT NULL,
	"loan_id" text,
	"args" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"loan_id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"borrower" text NOT NULL,
	"lender" text NOT NULL,
	"loan_token" text NOT NULL,
	"collateral_token" text NOT NULL,
	"principal_raw" numeric(78, 0) NOT NULL,
	"collateral_amount_raw" numeric(78, 0) NOT NULL,
	"accrued_interest_raw" numeric(78, 0),
	"interest_rate_bps" integer NOT NULL,
	"ltv_bps" integer NOT NULL,
	"liquidation_ltv_bps" integer NOT NULL,
	"current_ltv_bps" integer,
	"market_fee_bps" integer NOT NULL,
	"matcher_commission_bps" integer NOT NULL,
	"min_interest_bps" integer NOT NULL,
	"grace_period" integer NOT NULL,
	"start_time" bigint NOT NULL,
	"duration" bigint NOT NULL,
	"state" "loan_state" NOT NULL,
	"operator" text,
	"is_underwater" boolean,
	"created_at_block" bigint NOT NULL,
	"last_event_block" bigint NOT NULL,
	"last_hydrated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"market_id" text PRIMARY KEY NOT NULL,
	"loan_token_address" text NOT NULL,
	"loan_token_symbol" text NOT NULL,
	"loan_token_decimals" integer NOT NULL,
	"collateral_token_address" text NOT NULL,
	"collateral_token_symbol" text NOT NULL,
	"collateral_token_decimals" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracles" (
	"feed_address" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"decimals" integer NOT NULL,
	"latest_round_id" text NOT NULL,
	"latest_answer" numeric(78, 0) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at_block" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_by_loan_idx" ON "events" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "events_by_block_idx" ON "events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "events_by_event_idx" ON "events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "loans_by_market_idx" ON "loans" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "loans_by_borrower_idx" ON "loans" USING btree ("borrower");--> statement-breakpoint
CREATE INDEX "loans_by_lender_idx" ON "loans" USING btree ("lender");--> statement-breakpoint
CREATE INDEX "loans_by_state_idx" ON "loans" USING btree ("state");--> statement-breakpoint
CREATE INDEX "loans_by_collateral_idx" ON "loans" USING btree ("collateral_token");