// MCP config helpers + tool name lists
export {
  FLOE_MCP_SERVER_KEY,
  FLOE_TOOLS_ALL,
  FLOE_READ_TOOLS,
  FLOE_WRITE_TOOLS,
  FLOE_CAPITAL_MOVING_TOOLS,
  FLOE_AGENT_AWARENESS_TOOLS,
  floeMcpHttp,
  floeMcpStdio,
  floeMcpServers,
} from "./mcp.js";
export type {
  FloeMcpHttpOptions,
  FloeMcpStdioOptions,
  FloeMcpHttpServerConfig,
  FloeMcpStdioServerConfig,
} from "./mcp.js";

// Skill markdown + system-prompt helpers
export { FLOE_SKILL_MARKDOWN, floeSystemPrompt } from "./skill.js";
export type { FloeSystemPromptOptions, FloeSystemPromptValue } from "./skill.js";

// Hooks
export { floeCreditPreflight } from "./hooks/credit-preflight.js";
export type {
  FloeCreditPreflightOptions,
  PreflightOutcome,
} from "./hooks/credit-preflight.js";

export { floeBorrowEventLogger } from "./hooks/borrow-event-logger.js";
export type { FloeBorrowEventLoggerOptions } from "./hooks/borrow-event-logger.js";

// Spend-limit setup helpers
export {
  floeApplySpendLimit,
  floeClearSpendLimit,
  floeGetSpendLimit,
} from "./hooks/spend-limit.js";
export type { ApplySpendLimitOptions } from "./hooks/spend-limit.js";

// Re-export from core for convenience
export type {
  FloeClient,
  FloeClientOptions,
  CreditRemaining,
  LoanState,
  SpendLimit,
  X402CostEstimate,
  BorrowEvent,
  UsdcAmount,
} from "@floe-agents/core";
export {
  createFloeClient,
  FloeClientError,
  toUsdc,
  fromUsdc,
  formatUsdc,
} from "@floe-agents/core";
