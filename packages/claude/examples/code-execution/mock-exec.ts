/**
 * mock-exec — local x402-style paid code-execution endpoint.
 *
 * On every POST /exec it calls mock-floe's `/__mock/debit` to simulate
 * facilitator settlement. If mock-floe returns 402, this endpoint
 * propagates the 402 with x402-shaped metadata. On success it runs the
 * submitted code in Node's `vm` module with a stripped-down sandbox.
 *
 * **Demo only.** The vm sandbox is not a security boundary — do not run
 * untrusted code in production with this.
 *
 * Run standalone:
 *   pnpm tsx examples/code-execution/mock-exec.ts
 *
 * Env:
 *   MOCK_EXEC_PORT       (default 4041)
 *   MOCK_FLOE_URL        (default http://localhost:4040)
 *   MOCK_EXEC_PRICE_RAW  (default 50000 = 0.05 USDC)
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import express, { type Express } from "express";

const PORT = Number(process.env.MOCK_EXEC_PORT ?? 4041);
const PRICE_RAW = process.env.MOCK_EXEC_PRICE_RAW ?? "50000";

// Read MOCK_FLOE_URL on each request so tests can rebind after import.
function getFloeUrl(): string {
  return process.env.MOCK_FLOE_URL ?? "http://localhost:4040";
}

const app: Express = express();
app.use(express.json({ limit: "200kb" }));

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  returned: string | null;
  error?: string;
  duration_ms: number;
  paid_usdc: string;
}

app.post("/exec", async (req, res) => {
  const { code, language = "javascript" } = (req.body ?? {}) as {
    code?: string;
    language?: string;
  };
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "code (string) required" });
  }
  if (language !== "javascript") {
    return res.status(400).json({ error: `unsupported language: ${language}` });
  }

  // Settle via mock-floe. On 402, propagate x402 metadata.
  const settle = await fetch(`${getFloeUrl()}/__mock/debit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountRaw: PRICE_RAW, reason: "mock-exec" }),
  });
  if (!settle.ok) {
    const body = (await settle.json().catch(() => ({}))) as { error?: string };
    return res.status(402).json({
      x402: true,
      error: body.error ?? "payment_required",
      priceRaw: PRICE_RAW,
      asset: "0xMockUSDC",
      network: "base",
      payTo: "0xMockPayTo",
      scheme: "exact",
    });
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => stdout.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => stderr.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => stderr.push(args.map(String).join(" ")),
    info: (...args: unknown[]) => stdout.push(args.map(String).join(" ")),
  };

  const sandbox: Record<string, unknown> = {
    console: fakeConsole,
    Math,
    JSON,
    Date,
    Number,
    String,
    Array,
    Object,
    Promise,
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(`(async () => { ${code} })()`);

  const start = performance.now();
  let returned: unknown;
  let error: string | undefined;
  try {
    returned = await script.runInContext(ctx, { timeout: 2000 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const duration_ms = Math.round(performance.now() - start);

  const result: ExecResult = {
    ok: !error,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    returned:
      returned === undefined
        ? null
        : typeof returned === "string"
          ? returned
          : safeJson(returned),
    duration_ms,
    paid_usdc: PRICE_RAW,
  };
  if (error) result.error = error;
  res.json(result);
});

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = app.listen(PORT, () => {
    console.log(`[mock-exec] listening on http://localhost:${PORT}`);
    console.log(`[mock-exec] settling debits to ${getFloeUrl()}`);
    console.log(`[mock-exec] price per call: ${PRICE_RAW} USDC raw`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockExecApp };
