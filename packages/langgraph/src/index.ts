// Core middleware
export { withFloe } from "./with-floe.js";
export type { WithFloeOptions } from "./with-floe.js";

// Batteries-included node
export { floeCodeExecNode } from "./floe-code-exec.js";
export type { FloeCodeExecOptions } from "./floe-code-exec.js";

// Internal helper (exposed for advanced users who want to compose their own)
export { makeX402CallNode } from "./x402-call-node.js";
export type { MakeX402CallNodeOptions } from "./x402-call-node.js";

// Event + result types
export type {
  WithFloeEvent,
  PreflightWarningReason,
  CodeExecResult,
} from "./types.js";

// Re-exports from core for convenience
export type {
  FloeClient,
  FloeClientOptions,
  CreditRemaining,
  X402CostEstimate,
  UsdcAmount,
} from "@floe-agents/core";
export {
  createFloeClient,
  FloeClientError,
  toUsdc,
  fromUsdc,
  formatUsdc,
} from "@floe-agents/core";
