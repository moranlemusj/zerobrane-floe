import type { FloeClient } from "@floe-agents/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeX402CallNode } from "../x402-call-node.js";

describe("makeX402CallNode — direct mode", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires endpoint or proxy mode", () => {
    expect(() =>
      makeX402CallNode({
        client: {} as FloeClient,
        inputKey: "code",
        outputKey: "execution",
        language: "javascript",
        timeoutMs: 1000,
      }),
    ).toThrow(/either `endpoint`/);
  });

  it("POSTs to endpoint with the code from state and writes result", async () => {
    const fetchSpy = vi.fn(async (_url: unknown, _init?: unknown) =>
      new Response(
        JSON.stringify({
          ok: true,
          stdout: "",
          stderr: "",
          returned: "5",
          duration_ms: 10,
          paid_usdc: "50000",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const node = makeX402CallNode<{ code: string; execution?: unknown }>({
      endpoint: "https://api.example.com/exec",
      client: {} as FloeClient,
      inputKey: "code",
      outputKey: "execution",
      language: "javascript",
      timeoutMs: 1000,
      apiKey: "floe_live_test",
    });
    const result = await node({ code: "return 2+3;" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/exec");
    const i = init as { method?: string; headers?: Record<string, string>; body?: string };
    expect(i.method).toBe("POST");
    expect(i.headers?.Authorization).toBe("Bearer floe_live_test");
    expect(JSON.parse(i.body!)).toEqual({ code: "return 2+3;", language: "javascript" });
    expect(result.execution).toMatchObject({
      ok: true,
      returned: "5",
      paidUsdc: "50000",
      durationMs: 10,
    });
  });

  it("returns ok=false on non-2xx without throwing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 402 }),
    ) as unknown as typeof fetch;
    const node = makeX402CallNode<{ code: string; execution?: unknown }>({
      endpoint: "https://api.example.com/exec",
      client: {} as FloeClient,
      inputKey: "code",
      outputKey: "execution",
      language: "javascript",
      timeoutMs: 1000,
    });
    const result = await node({ code: "return 1;" });
    expect((result.execution as { ok: boolean }).ok).toBe(false);
  });

  it("throws on missing/non-string state[inputKey]", async () => {
    const node = makeX402CallNode<{ code?: unknown }>({
      endpoint: "https://api.example.com/exec",
      client: {} as FloeClient,
      inputKey: "code",
      outputKey: "execution",
      language: "javascript",
      timeoutMs: 1000,
    });
    await expect(node({ code: 42 })).rejects.toThrow(/expected state/);
  });
});

describe("makeX402CallNode — proxy mode", () => {
  it("calls client.proxyFetch with url + body", async () => {
    const proxyFetch = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: {
        ok: true,
        stdout: "",
        stderr: "",
        returned: "42",
        duration_ms: 1,
        paid_usdc: "50000",
      },
    }));
    const client = { proxyFetch } as unknown as FloeClient;
    const node = makeX402CallNode<{ code: string; execution?: unknown }>({
      endpoint: "https://api.example.com/exec",
      useFloeProxy: true,
      client,
      inputKey: "code",
      outputKey: "execution",
      language: "javascript",
      timeoutMs: 1000,
    });
    const result = await node({ code: "return 42;" });
    expect(proxyFetch).toHaveBeenCalledWith({
      url: "https://api.example.com/exec",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { code: "return 42;", language: "javascript" },
    });
    expect((result.execution as { returned: string }).returned).toBe("42");
  });

  it("proxy mode requires endpoint", () => {
    expect(() =>
      makeX402CallNode({
        useFloeProxy: true,
        client: {} as FloeClient,
        inputKey: "code",
        outputKey: "execution",
        language: "javascript",
        timeoutMs: 1000,
      }),
    ).toThrow(/proxy mode still requires/);
  });
});
