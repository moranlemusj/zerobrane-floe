import { describe, expect, it, vi } from "vitest";
import { floeBorrowEventLogger } from "../hooks/borrow-event-logger.js";
import type { PostToolUseHookInput } from "../hooks/types.js";

function makePost(toolName: string, toolResponse: unknown): PostToolUseHookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "sess-1",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: {},
    tool_response: toolResponse,
    tool_use_id: "tu-1",
  };
}

describe("floeBorrowEventLogger", () => {
  it("default matcher targets capital-moving Floe MCP tools", () => {
    const matcher = floeBorrowEventLogger({ onEvent: () => {} }).matcher!;
    expect(matcher).toContain("create_counter_intent");
    expect(matcher).toContain("repay_loan");
    expect(matcher).toContain("liquidate_loan");
    expect(matcher).toContain("broadcast_transaction");
  });

  it("emits a structured event for repay_loan", async () => {
    const events: unknown[] = [];
    const m = floeBorrowEventLogger({ onEvent: (e) => events.push(e) });
    await m.hooks[0]?.(
      makePost("mcp__floe__repay_loan", { transactions: [{ to: "0x" }] }),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "repay",
      toolName: "mcp__floe__repay_loan",
      details: { transactions: [{ to: "0x" }] },
    });
  });

  it("emits 'liquidate' for liquidate_loan", async () => {
    const events: unknown[] = [];
    const m = floeBorrowEventLogger({ onEvent: (e) => events.push(e) });
    await m.hooks[0]?.(
      makePost("mcp__floe__liquidate_loan", { ok: true }),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(events[0]).toMatchObject({ type: "liquidate" });
  });

  it("emits 'collateral_added' for add_collateral", async () => {
    const events: unknown[] = [];
    const m = floeBorrowEventLogger({ onEvent: (e) => events.push(e) });
    await m.hooks[0]?.(
      makePost("mcp__floe__add_collateral", {}),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(events[0]).toMatchObject({ type: "collateral_added" });
  });

  it("emits 'borrow' for broadcast_transaction (the catch-all)", async () => {
    const events: unknown[] = [];
    const m = floeBorrowEventLogger({ onEvent: (e) => events.push(e) });
    await m.hooks[0]?.(
      makePost("mcp__floe__broadcast_transaction", { txHash: "0xabc" }),
      undefined,
      { signal: new AbortController().signal },
    );
    expect(events[0]).toMatchObject({
      type: "borrow",
      details: { txHash: "0xabc" },
    });
  });

  it("respects custom matcher", () => {
    const m = floeBorrowEventLogger({ matcher: "^custom$", onEvent: () => {} });
    expect(m.matcher).toBe("^custom$");
  });

  it("returns NOOP for non-PostToolUse events", async () => {
    const onEvent = vi.fn();
    const m = floeBorrowEventLogger({ onEvent });
    const result = await m.hooks[0]?.(
      // @ts-expect-error — intentional
      { hook_event_name: "PreToolUse" },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({});
    expect(onEvent).not.toHaveBeenCalled();
  });
});
