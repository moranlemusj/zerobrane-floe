/**
 * MCP server config helpers + Floe MCP tool name constants.
 *
 * Tool names are sourced from `@floelabs/mcp-server`. The Claude Agent SDK
 * prefixes MCP tool names with `mcp__<server-key>__<tool-name>`; we use
 * `floe` as the server key (see `FLOE_MCP_SERVER_KEY`).
 */

export const FLOE_MCP_SERVER_KEY = "floe" as const;

/** Glob matcher that catches every Floe MCP tool. Useful for hook matchers. */
export const FLOE_TOOLS_ALL = "mcp__floe__*" as const;

const PREFIX = `mcp__${FLOE_MCP_SERVER_KEY}__` as const;

/**
 * Read-only tools (12). Safe to call freely; never move capital or change state.
 */
export const FLOE_READ_TOOLS: readonly string[] = [
  `${PREFIX}get_markets`,
  `${PREFIX}get_market_details`,
  `${PREFIX}get_open_lend_intents`,
  `${PREFIX}get_open_borrow_intents`,
  `${PREFIX}get_intent_details`,
  `${PREFIX}get_loan`,
  `${PREFIX}get_user_loans`,
  `${PREFIX}get_loan_health`,
  `${PREFIX}get_liquidation_quote`,
  `${PREFIX}get_token_price`,
  `${PREFIX}get_wallet_balance`,
  `${PREFIX}get_accrued_interest`,
];

/**
 * Write tools (9). Return unsigned transactions; do not move capital by themselves
 * (signing + broadcasting moves capital).
 */
export const FLOE_WRITE_TOOLS: readonly string[] = [
  `${PREFIX}create_lend_intent`,
  `${PREFIX}create_borrow_intent`,
  `${PREFIX}create_counter_intent`,
  `${PREFIX}repay_loan`,
  `${PREFIX}add_collateral`,
  `${PREFIX}withdraw_collateral`,
  `${PREFIX}liquidate_loan`,
  `${PREFIX}revoke_intent`,
  `${PREFIX}approve_token`,
];

/**
 * Capital-moving subset of write tools — the ones the borrow-event logger
 * watches. `broadcast_transaction` is included because that's the call that
 * actually moves capital onchain (the others return unsigned txs).
 */
export const FLOE_CAPITAL_MOVING_TOOLS: readonly string[] = [
  `${PREFIX}create_counter_intent`,
  `${PREFIX}repay_loan`,
  `${PREFIX}add_collateral`,
  `${PREFIX}withdraw_collateral`,
  `${PREFIX}liquidate_loan`,
  `${PREFIX}broadcast_transaction`,
];

/**
 * Agent-awareness tools (9). Credit state, spend limits, threshold webhooks,
 * x402 cost preflight.
 */
export const FLOE_AGENT_AWARENESS_TOOLS: readonly string[] = [
  `${PREFIX}get_credit_remaining`,
  `${PREFIX}get_loan_state`,
  `${PREFIX}get_spend_limit`,
  `${PREFIX}set_spend_limit`,
  `${PREFIX}clear_spend_limit`,
  `${PREFIX}list_credit_thresholds`,
  `${PREFIX}register_credit_threshold`,
  `${PREFIX}delete_credit_threshold`,
  `${PREFIX}estimate_x402_cost`,
];

const DEFAULT_HTTP_URL = "https://mcp.floelabs.xyz/mcp";
const DEFAULT_STDIO_PACKAGE = "@floelabs/mcp-server";

export interface FloeMcpHttpOptions {
  apiKey: string;
  /** Override the hosted MCP URL (mock servers, staging, etc.). Default: `https://mcp.floelabs.xyz/mcp`. */
  url?: string;
  /** Extra headers to merge in. Authorization is set automatically from `apiKey`. */
  extraHeaders?: Record<string, string>;
}

export interface FloeMcpStdioOptions {
  apiKey: string;
  /** Override the npm package name. Default: `@floelabs/mcp-server`. */
  packageName?: string;
  /** Custom command (default: `npx -y <packageName>`). */
  command?: string;
  /** Custom args (default: `["-y", packageName]`). */
  args?: string[];
  /** Extra env vars to merge in. `FLOE_API_KEY` is set automatically. */
  extraEnv?: Record<string, string>;
}

export interface FloeMcpHttpServerConfig {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

export interface FloeMcpStdioServerConfig {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Build an `McpHttpServerConfig` for the hosted Floe MCP endpoint. */
export function floeMcpHttp(opts: FloeMcpHttpOptions): FloeMcpHttpServerConfig {
  if (!opts.apiKey) throw new Error("floeMcpHttp: apiKey is required");
  return {
    type: "http",
    url: opts.url ?? DEFAULT_HTTP_URL,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      ...(opts.extraHeaders ?? {}),
    },
  };
}

/** Build an `McpStdioServerConfig` that spawns the Floe MCP server via npx. */
export function floeMcpStdio(opts: FloeMcpStdioOptions): FloeMcpStdioServerConfig {
  if (!opts.apiKey) throw new Error("floeMcpStdio: apiKey is required");
  const pkg = opts.packageName ?? DEFAULT_STDIO_PACKAGE;
  return {
    type: "stdio",
    command: opts.command ?? "npx",
    args: opts.args ?? ["-y", pkg],
    env: {
      FLOE_API_KEY: opts.apiKey,
      ...(opts.extraEnv ?? {}),
    },
  };
}

/**
 * Helper: build the `mcpServers` map for `query()` options.
 *
 * ```ts
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { floeMcpServers, floeMcpHttp } from "floe-claude-agent";
 *
 * await query({
 *   prompt: "...",
 *   options: {
 *     mcpServers: floeMcpServers(floeMcpHttp({ apiKey: process.env.FLOE_API_KEY! })),
 *   },
 * });
 * ```
 */
export function floeMcpServers<T extends FloeMcpHttpServerConfig | FloeMcpStdioServerConfig>(
  config: T,
): Record<typeof FLOE_MCP_SERVER_KEY, T> {
  return { [FLOE_MCP_SERVER_KEY]: config } as Record<typeof FLOE_MCP_SERVER_KEY, T>;
}
