// The package's only export: the withFloe instrumentation middleware.
// Users do paid HTTP via `client.proxyFetch` (from @floe-agents/core) inside
// their own nodes; withFloe wraps the node with credit preflight + spend
// telemetry.
export { withFloe } from "./with-floe.js";
export type { WithFloeOptions } from "./with-floe.js";

export type {
  WithFloeEvent,
  PreflightWarningReason,
} from "./types.js";

// Re-exports from core for convenience.
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
