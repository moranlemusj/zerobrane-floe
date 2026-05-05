import type { BorrowEvent } from "@floe-agents/core";
import { FLOE_CAPITAL_MOVING_TOOLS } from "../mcp.js";
import {
  type HookCallback,
  type HookCallbackMatcher,
  NOOP_HOOK_OUTPUT,
  type PostToolUseHookInput,
} from "./types.js";

/**
 * Default matcher: only the Floe MCP write tools that move (or finalize the
 * movement of) capital. Source: FLOE_CAPITAL_MOVING_TOOLS in `../mcp.ts`.
 */
const DEFAULT_CAPITAL_MOVING_MATCHER = `^(${FLOE_CAPITAL_MOVING_TOOLS.map(escapeRegex).join("|")})$`;

const TOOL_TO_EVENT_KIND: Record<string, BorrowEvent["type"]> = {
  mcp__floe__create_counter_intent: "match",
  mcp__floe__repay_loan: "repay",
  mcp__floe__add_collateral: "collateral_added",
  mcp__floe__withdraw_collateral: "collateral_withdrawn",
  mcp__floe__liquidate_loan: "liquidate",
  mcp__floe__broadcast_transaction: "borrow",
};

export interface FloeBorrowEventLoggerOptions {
  /** Custom regex matcher (string). Default catches Floe's capital-moving tools. */
  matcher?: string;
  /** Called with a structured event for every matched tool call. */
  onEvent: (event: BorrowEvent) => void;
}

/**
 * Build a `PostToolUse` hook matcher that emits a `BorrowEvent` for each
 * capital-moving Floe MCP tool invocation.
 *
 * The hook runs *after* the tool returns, so it observes successful
 * invocations only. If the inner tool failed, no event fires (the SDK
 * routes failures to `PostToolUseFailure`).
 */
export function floeBorrowEventLogger(
  opts: FloeBorrowEventLoggerOptions,
): HookCallbackMatcher {
  const matcher = opts.matcher ?? DEFAULT_CAPITAL_MOVING_MATCHER;

  const callback: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return NOOP_HOOK_OUTPUT;
    const post = input as PostToolUseHookInput;
    const kind = TOOL_TO_EVENT_KIND[post.tool_name] ?? "borrow";
    opts.onEvent({
      type: kind,
      toolName: post.tool_name,
      details: post.tool_response,
      timestamp: Date.now(),
    });
    return NOOP_HOOK_OUTPUT;
  };

  return {
    matcher,
    hooks: [callback],
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
