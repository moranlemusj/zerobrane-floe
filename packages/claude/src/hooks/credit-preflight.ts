import type { CreditRemaining, FloeClient, X402CostEstimate } from "@floe-agents/core";
import {
  type HookCallback,
  type HookCallbackMatcher,
  NOOP_HOOK_OUTPUT,
  type PreToolUseHookInput,
} from "./types.js";

const DEFAULT_NON_FLOE_MATCHER = "^(?!mcp__floe__).+$";
const DEFAULT_WARN_AT_UTILIZATION_BPS = 8000;

/**
 * Result of a single preflight evaluation, surfaced to `onPreflight` for
 * logging / telemetry. The hook never blocks the underlying tool call —
 * the facilitator is the source of truth for affordability.
 */
export type PreflightOutcome =
  | { kind: "ok"; remaining: CreditRemaining }
  | { kind: "low_credit_warning"; remaining: CreditRemaining; utilizationBps: number }
  | { kind: "would_exceed"; estimate: X402CostEstimate }
  | { kind: "spend_limit_blocked"; estimate: X402CostEstimate }
  | { kind: "skipped"; reason: "no_url_extractor" | "matcher_excluded" };

export interface FloeCreditPreflightOptions {
  client: FloeClient;
  /**
   * Regex (as string) matched against tool names. Default excludes Floe's
   * own MCP tools to avoid recursion / redundant preflight on cheap
   * read calls.
   */
  matcher?: string;
  /**
   * Optional adapter that extracts a URL + method from a tool's input,
   * so we can call `estimateX402Cost` and inspect its `reflection` block.
   * If `null`/omitted, the hook falls back to a plain `getCreditRemaining`
   * read and emits a warning when utilization is high.
   */
  estimateUrlFromInput?: (
    toolName: string,
    input: unknown,
  ) => { url: string; method?: string } | null;
  /** Utilization threshold (bps) above which `low_credit_warning` fires. Default 8000 (80%). */
  warnAtUtilizationBps?: number;
  /** Telemetry callback. Fires for every evaluation. */
  onPreflight?: (info: PreflightOutcome) => void;
  /** Errors talking to Floe go here; the hook still returns NOOP. */
  onError?: (err: unknown) => void;
}

/**
 * Build a `PreToolUse` hook matcher that runs Floe credit preflight before
 * non-Floe tool calls.
 *
 * Contract:
 *   - Never blocks tool execution (returns NOOP regardless).
 *   - Never throws back into the SDK (errors go to `onError`).
 *   - Calls `estimateX402Cost` when an URL extractor is provided; otherwise
 *     falls back to `getCreditRemaining`.
 */
export function floeCreditPreflight(opts: FloeCreditPreflightOptions): HookCallbackMatcher {
  const matcher = opts.matcher ?? DEFAULT_NON_FLOE_MATCHER;
  const warnAt = opts.warnAtUtilizationBps ?? DEFAULT_WARN_AT_UTILIZATION_BPS;

  const callback: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NOOP_HOOK_OUTPUT;
    const pre = input as PreToolUseHookInput;
    try {
      const candidate = opts.estimateUrlFromInput?.(pre.tool_name, pre.tool_input);

      if (candidate) {
        const estimate = await opts.client.estimateX402Cost(candidate);
        const r = estimate.reflection;
        if (r.willExceedSpendLimit) {
          opts.onPreflight?.({ kind: "spend_limit_blocked", estimate });
        } else if (r.willExceedAvailable && r.willExceedHeadroom) {
          opts.onPreflight?.({ kind: "would_exceed", estimate });
        } else {
          // For URL-derived preflights, "ok" still includes a fresh credit read for context.
          const remaining = await opts.client.getCreditRemaining();
          opts.onPreflight?.({ kind: "ok", remaining });
        }
      } else if (opts.estimateUrlFromInput) {
        opts.onPreflight?.({ kind: "skipped", reason: "no_url_extractor" });
      } else {
        const remaining = await opts.client.getCreditRemaining();
        if (remaining.utilizationBps >= warnAt) {
          opts.onPreflight?.({
            kind: "low_credit_warning",
            remaining,
            utilizationBps: remaining.utilizationBps,
          });
        } else {
          opts.onPreflight?.({ kind: "ok", remaining });
        }
      }
    } catch (err) {
      opts.onError?.(err);
    }
    return NOOP_HOOK_OUTPUT;
  };

  return {
    matcher,
    hooks: [callback],
  };
}
