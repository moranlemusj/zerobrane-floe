/**
 * Re-export structural shapes that mirror the Claude Agent SDK's hook types
 * so we don't force a hard runtime import. The SDK is a peer dep — its
 * types are available at typecheck time when installed.
 */

export type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

/** Empty sync-output that takes no action — the default hook return for non-blocking observers. */
export const NOOP_HOOK_OUTPUT: HookJSONOutput = {};
