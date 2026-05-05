import type { CreditRemaining, UsdcAmount, X402CostEstimate } from "@floe-agents/core";

/**
 * Reasons a preflight warning fires. Surfaced to `onEvent` for telemetry.
 */
export type PreflightWarningReason =
  | "low_credit"
  | "would_exceed"
  | "spend_limit_blocked";

export type WithFloeEvent =
  | { type: "preflight_ok"; remaining: CreditRemaining; ts: number }
  | {
      type: "preflight_warning";
      remaining: CreditRemaining;
      reason: PreflightWarningReason;
      estimate?: X402CostEstimate;
      ts: number;
    }
  | { type: "node_started"; ts: number }
  | { type: "node_completed"; durationMs: number }
  | {
      type: "credit_consumed";
      deltaUsdc: UsdcAmount;
      before: CreditRemaining;
      after: CreditRemaining;
    }
  | { type: "error"; phase: "preflight" | "node" | "post"; err: unknown };
