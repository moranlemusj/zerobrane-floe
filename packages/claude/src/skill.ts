/**
 * Floe Skill markdown + system-prompt helpers.
 *
 * Phase 1 ships the skill content as a string append to the system prompt
 * (rather than a real Skill file at `~/.claude/skills/`). This keeps the
 * binding self-contained — no install side effects.
 */

export const FLOE_SKILL_MARKDOWN = `# Floe — onchain credit for AI agents

You have access to Floe's MCP tools (\`mcp__floe__*\`) for managing onchain
credit on Base. Floe is a credit/borrow protocol with a payment facilitator;
**you do not manually borrow before each paid HTTP call**. The facilitator
handles borrowing automatically when paid HTTP needs to settle.

## How to think about credit

Use \`mcp__floe__get_credit_remaining\` to read your current state:

- \`available\`: USDC already borrowed and unspent. You can spend this freely.
- \`headroomToAutoBorrow\`: additional amount the facilitator can borrow on
  your behalf when paid HTTP settles. Counts toward affordability.
- \`utilizationBps\`: 0–10000. 8000+ means you're approaching your credit
  limit; consider repaying before more borrowing.
- \`sessionSpent\` / \`sessionSpendRemaining\`: spend tracked against the
  current session's spend limit. If \`sessionSpendRemaining\` hits zero,
  paid calls will be rejected.

## Before a paid call

Use \`mcp__floe__estimate_x402_cost\` with the URL you intend to call. The
response includes a \`reflection\` block:

- \`willExceedAvailable: true\` and \`willExceedHeadroom: true\` → call will
  fail. Do not attempt; tell the user the credit limit is exhausted.
- \`willExceedSpendLimit: true\` → spend limit blocks this. Do not retry
  past the user's cap.
- All flags false → safe to proceed.

## Borrowing

Borrowing is implicit — you do not need to call \`instant_borrow\` before a
paid call. The facilitator handles it. Only call protocol-level borrow tools
(\`create_borrow_intent\`, \`create_counter_intent\`) when the user
explicitly asks for a manual borrow against a specific market.

When you do borrow manually, **borrow only what's needed for the user's
task** — not speculative amounts. Early repayment may incur a fee; let
loans run to maturity unless the user asks otherwise.

## Spend limits

If you hit a spend-limit rejection, **stop**. Do not retry. Tell the user
their session cap was reached and let them decide whether to raise it.

## What not to surface

Do not mention USDC balances, borrow events, or loan state in your
responses **unless the user asks**. Treat these as backend plumbing.
`;

export interface FloeSystemPromptOptions {
  /** Extra append after the Floe skill content. */
  append?: string;
  /**
   * If true, returns the SDK's `claude_code` preset shape, which keeps the
   * default Claude Code system prompt and appends the Floe skill. Default: true.
   */
  withClaudeCodePreset?: boolean;
}

export type FloeSystemPromptValue =
  | string
  | { type: "preset"; preset: "claude_code"; append: string };

/**
 * Build a `systemPrompt` value for the Claude Agent SDK that includes the
 * Floe skill content. Defaults to using the `claude_code` preset so the
 * default system prompt is preserved.
 *
 * ```ts
 * await query({
 *   prompt: "Find the cheapest x402 search API and call it.",
 *   options: {
 *     systemPrompt: floeSystemPrompt(),
 *     mcpServers: floeMcpServers(floeMcpHttp({ apiKey })),
 *   },
 * });
 * ```
 */
export function floeSystemPrompt(opts: FloeSystemPromptOptions = {}): FloeSystemPromptValue {
  const append = opts.append
    ? `${FLOE_SKILL_MARKDOWN}\n\n${opts.append}`
    : FLOE_SKILL_MARKDOWN;
  if (opts.withClaudeCodePreset === false) {
    return append;
  }
  return { type: "preset", preset: "claude_code", append };
}
