import type { CreditRemaining, FloeClient, UsdcAmount } from "@floe-agents/core";
import type { WithFloeEvent } from "./types.js";

const DEFAULT_WARN_AT_UTILIZATION_BPS = 8000;

export interface WithFloeOptions<S = unknown> {
  client: FloeClient;
  /**
   * Optional preflight config. If `estimate` is provided, the middleware
   * calls `estimateX402Cost` against the URL it returns and inspects the
   * `reflection` block. Otherwise it falls back to a `getCreditRemaining`
   * read and emits a warning when utilization is high.
   */
  preflight?: {
    estimate?: (state: S) => { url: string; method?: string } | null;
    warnAtUtilizationBps?: number;
  };
  /**
   * If true (default), capture `credit-remaining` snapshots before and
   * after the inner node and emit a `credit_consumed` event with the
   * delta. The delta is observed, not enforced — Floe is the authority.
   */
  trackSpend?: boolean;
  /** Free-text tag included in events. Useful when wrapping multiple nodes. */
  reason?: string;
  onEvent?: (e: WithFloeEvent) => void;
}

/**
 * Wrap a LangGraph node with Floe credit semantics:
 *   - preflight (read or estimate) before the inner node runs
 *   - the inner node runs whether or not preflight succeeded
 *   - credit-remaining snapshots before/after, diffed for telemetry
 *
 * **Errors during preflight or post-snapshot do not block the inner
 * node** — Floe-side flake should never mask the agent's actual work.
 * Errors thrown by the inner node propagate (the `error` event with
 * `phase: "node"` fires first).
 */
export function withFloe<S extends Record<string, unknown> | unknown>(
  node: (state: S) => Promise<Partial<S>>,
  opts: WithFloeOptions<S>,
): (state: S) => Promise<Partial<S>> {
  const trackSpend = opts.trackSpend ?? true;
  const warnAt = opts.preflight?.warnAtUtilizationBps ?? DEFAULT_WARN_AT_UTILIZATION_BPS;

  return async (state: S): Promise<Partial<S>> => {
    let before: CreditRemaining | null = null;

    // Preflight
    try {
      const candidate = opts.preflight?.estimate?.(state);
      if (candidate) {
        const estimate = await opts.client.estimateX402Cost(candidate);
        const r = estimate.reflection;
        if (r.willExceedSpendLimit) {
          const remaining = await opts.client.getCreditRemaining();
          before = remaining;
          opts.onEvent?.({
            type: "preflight_warning",
            remaining,
            reason: "spend_limit_blocked",
            estimate,
            ts: Date.now(),
          });
        } else if (r.willExceedAvailable && r.willExceedHeadroom) {
          const remaining = await opts.client.getCreditRemaining();
          before = remaining;
          opts.onEvent?.({
            type: "preflight_warning",
            remaining,
            reason: "would_exceed",
            estimate,
            ts: Date.now(),
          });
        } else {
          const remaining = trackSpend ? await opts.client.getCreditRemaining() : nullCredit();
          before = trackSpend ? remaining : null;
          opts.onEvent?.({ type: "preflight_ok", remaining, ts: Date.now() });
        }
      } else {
        const remaining = await opts.client.getCreditRemaining();
        before = remaining;
        if (remaining.utilizationBps >= warnAt) {
          opts.onEvent?.({
            type: "preflight_warning",
            remaining,
            reason: "low_credit",
            ts: Date.now(),
          });
        } else {
          opts.onEvent?.({ type: "preflight_ok", remaining, ts: Date.now() });
        }
      }
    } catch (err) {
      opts.onEvent?.({ type: "error", phase: "preflight", err });
    }

    // Inner node
    const startedAt = Date.now();
    opts.onEvent?.({ type: "node_started", ts: startedAt });
    let result: Partial<S>;
    try {
      result = await node(state);
    } catch (err) {
      opts.onEvent?.({ type: "error", phase: "node", err });
      throw err;
    }
    const durationMs = Date.now() - startedAt;
    opts.onEvent?.({ type: "node_completed", durationMs });

    // Post-snapshot: derive the delta. before may be null if preflight read failed.
    if (trackSpend) {
      try {
        const after = await opts.client.getCreditRemaining();
        if (before) {
          const delta = computeDelta(before, after);
          opts.onEvent?.({ type: "credit_consumed", deltaUsdc: delta, before, after });
        }
      } catch (err) {
        opts.onEvent?.({ type: "error", phase: "post", err });
      }
    }

    return result;
  };
}

/**
 * `delta = after.sessionSpent - before.sessionSpent`. We use sessionSpent
 * (not creditOut) because that's what the Floe spend cap tracks, and it
 * captures the actual settled amount whether or not the facilitator
 * borrowed to fund it.
 */
function computeDelta(before: CreditRemaining, after: CreditRemaining): UsdcAmount {
  return after.sessionSpent - before.sessionSpent;
}

function nullCredit(): CreditRemaining {
  return {
    available: 0n,
    creditIn: 0n,
    creditOut: 0n,
    creditLimit: 0n,
    headroomToAutoBorrow: 0n,
    utilizationBps: 0,
    sessionSpendLimit: null,
    sessionSpent: 0n,
    sessionSpendRemaining: null,
    asOf: "",
  };
}
