import type { FloeClient } from "@floe-agents/core";
import type { CodeExecResult } from "./types.js";

/**
 * Internal helper that builds an inner LangGraph node which performs the
 * actual paid HTTP call. Used by `floeCodeExecNode`. Two modes:
 *
 *   - **Direct mode** (`endpoint` provided): POST to the x402 URL with the
 *     agent's Floe API key on the auth chain. The Floe facilitator settles
 *     server-to-server when it sees the request.
 *
 *   - **Proxy mode** (`useFloeProxy: true`): route through
 *     `client.proxyFetch`. Floe handles the 402 dance and returns the
 *     proxied response.
 *
 * Both shapes return a `CodeExecResult`-shaped payload at
 * `state[outputKey]`.
 */

export interface MakeX402CallNodeOptions<S extends Record<string, unknown>> {
  endpoint?: string;
  useFloeProxy?: boolean;
  client: FloeClient;
  inputKey: string;
  outputKey: string;
  language: "javascript" | "python";
  timeoutMs: number;
  apiKey?: string;
}

export function makeX402CallNode<S extends Record<string, unknown>>(
  opts: MakeX402CallNodeOptions<S>,
): (state: S) => Promise<Partial<S>> {
  if (!opts.endpoint && !opts.useFloeProxy) {
    throw new Error(
      "makeX402CallNode: pass either `endpoint` (direct mode) or `useFloeProxy: true` (proxy mode).",
    );
  }
  if (opts.useFloeProxy && !opts.endpoint) {
    throw new Error("makeX402CallNode: proxy mode still requires `endpoint` (the URL to proxy).");
  }

  return async (state: S): Promise<Partial<S>> => {
    const code = state[opts.inputKey];
    if (typeof code !== "string") {
      throw new Error(
        `makeX402CallNode: expected state[${JSON.stringify(opts.inputKey)}] to be a string, got ${typeof code}`,
      );
    }
    const body = { code, language: opts.language };

    let result: CodeExecResult;

    if (opts.useFloeProxy) {
      const proxyResponse = await opts.client.proxyFetch({
        url: opts.endpoint!,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      result = normalizeExecResult(proxyResponse.body);
    } else {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), opts.timeoutMs);
      try {
        const res = await fetch(opts.endpoint!, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const parsed = (await res.json().catch(() => ({}))) as unknown;
        if (!res.ok) {
          result = {
            ok: false,
            stdout: "",
            stderr: "",
            returned: null,
            error: `HTTP ${res.status}`,
            durationMs: 0,
            paidUsdc: "0",
          };
        } else {
          result = normalizeExecResult(parsed);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return { [opts.outputKey]: result } as Partial<S>;
  };
}

function normalizeExecResult(raw: unknown): CodeExecResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      returned: null,
      error: "non-object response",
      durationMs: 0,
      paidUsdc: "0",
    };
  }
  const obj = raw as Record<string, unknown>;
  const result: CodeExecResult = {
    ok: Boolean(obj.ok),
    stdout: typeof obj.stdout === "string" ? obj.stdout : "",
    stderr: typeof obj.stderr === "string" ? obj.stderr : "",
    returned:
      typeof obj.returned === "string" || obj.returned === null
        ? (obj.returned as string | null)
        : null,
    durationMs:
      typeof obj.duration_ms === "number"
        ? obj.duration_ms
        : typeof obj.durationMs === "number"
          ? obj.durationMs
          : 0,
    paidUsdc:
      typeof obj.paid_usdc === "string"
        ? obj.paid_usdc
        : typeof obj.paidUsdc === "string"
          ? obj.paidUsdc
          : "0",
  };
  if (typeof obj.error === "string") result.error = obj.error;
  return result;
}
