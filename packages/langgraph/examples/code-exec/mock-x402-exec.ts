/**
 * mock-x402-exec — local x402-style paid code-execution endpoint.
 *
 * POST /exec { code, language? } → CodeExecResult-shaped JSON.
 * Settles via mock-floe's /__mock/debit. **Demo only** — vm sandbox is
 * not a security boundary.
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import express, { type Express } from "express";

const PORT = Number(process.env.MOCK_EXEC_PORT ?? 4043);
const PRICE_RAW = process.env.MOCK_EXEC_PRICE_RAW ?? "50000";

function getFloeUrl(): string {
  return process.env.MOCK_FLOE_URL ?? "http://localhost:4040";
}

const app: Express = express();
app.use(express.json({ limit: "200kb" }));

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

  // If the request came through Floe's proxy, settlement already happened
  // upstream; skip our own debit to avoid double-charging.
  const alreadySettled = req.header("x-floe-settled") === "true";
  if (!alreadySettled) {
    const settle = await fetch(`${getFloeUrl()}/__mock/debit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountRaw: PRICE_RAW, reason: "mock-x402-exec" }),
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

  const result: {
    ok: boolean;
    stdout: string;
    stderr: string;
    returned: string | null;
    error?: string;
    duration_ms: number;
    paid_usdc: string;
  } = {
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
    console.log(`[mock-x402-exec] listening on http://localhost:${PORT}`);
    console.log(`[mock-x402-exec] settling debits to ${getFloeUrl()}`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockX402ExecApp };
