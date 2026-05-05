import type { FloeClient } from "@floe-agents/core";
import type { CodeExecResult, WithFloeEvent } from "./types.js";
import { makeX402CallNode } from "./x402-call-node.js";
import { type WithFloeOptions, withFloe } from "./with-floe.js";

export interface FloeCodeExecOptions<S extends Record<string, unknown>> {
  /**
   * x402-protected code-exec endpoint. Required in both modes:
   *   - direct mode (default): POSTed to with the Floe API key on the auth chain
   *   - proxy mode: passed as the `url` to `client.proxyFetch`
   */
  endpoint: string;
  /** If set, route through Floe's `/v1/proxy/fetch` (server-side x402 settlement). */
  proxy?: { useFloeProxy: true };
  /** Floe client + the same preflight/onEvent/trackSpend options as `withFloe`. */
  floe: { client: FloeClient } & Pick<
    WithFloeOptions<S>,
    "preflight" | "onEvent" | "trackSpend"
  >;
  /** State key to read the code string from. Default: `"code"`. */
  inputKey?: string;
  /** State key to write the `CodeExecResult` to. Default: `"execution"`. */
  outputKey?: string;
  /** Language tag passed to the endpoint. Default: `"javascript"`. */
  language?: "javascript" | "python";
  /** AbortController timeout for the inner POST. Default: 30_000. */
  timeoutMs?: number;
  /** API key to include on direct-mode calls. Defaults to whatever the FloeClient was built with. */
  apiKey?: string;
}

/**
 * Batteries-included LangGraph node for x402-paid sandboxed code execution.
 *
 * Composed internally as `withFloe(makeX402CallNode(...))`, so it gives you
 * the full credit preflight + spend-tracking story in a single import. The
 * node reads `state[inputKey]` (a JS string), POSTs to the x402 endpoint,
 * and writes the parsed `CodeExecResult` to `state[outputKey]`.
 *
 * After the inner POST completes, the wrapping `withFloe` middleware
 * derives the actual USDC consumed by diffing `credit-remaining` snapshots
 * around the call. The exec result's `paidUsdc` field comes from the
 * endpoint itself; the `credit_consumed` event's `deltaUsdc` is the
 * authoritative number from Floe.
 */
export function floeCodeExecNode<S extends Record<string, unknown>>(
  opts: FloeCodeExecOptions<S>,
): (state: S) => Promise<Partial<S>> {
  const inputKey = opts.inputKey ?? "code";
  const outputKey = opts.outputKey ?? "execution";

  const inner = makeX402CallNode<S>({
    endpoint: opts.endpoint,
    useFloeProxy: opts.proxy?.useFloeProxy === true,
    client: opts.floe.client,
    inputKey,
    outputKey,
    language: opts.language ?? "javascript",
    timeoutMs: opts.timeoutMs ?? 30_000,
    apiKey: opts.apiKey,
  });

  // Default URL extractor for the preflight: estimate against the configured endpoint.
  const wrappedOpts: WithFloeOptions<S> = {
    client: opts.floe.client,
    preflight: opts.floe.preflight ?? {
      estimate: () => ({ url: opts.endpoint, method: "POST" }),
    },
    ...(opts.floe.trackSpend !== undefined ? { trackSpend: opts.floe.trackSpend } : {}),
    ...(opts.floe.onEvent ? { onEvent: opts.floe.onEvent } : {}),
  };

  return withFloe<S>(inner, wrappedOpts);
}

export type { CodeExecResult, WithFloeEvent };
