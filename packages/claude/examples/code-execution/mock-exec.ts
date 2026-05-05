/**
 * mock-exec — plain paid code-execution endpoint.
 *
 * Runs the submitted JS in Node's `vm` and returns the result.
 * **Performs no settlement of its own.** The agent reaches this
 * endpoint via Floe's facilitator (`mock-floe`'s `/v1/proxy/fetch`),
 * which debits + forwards. From this server's perspective, the call
 * has already been paid for.
 *
 * Demo only — `vm` is not a security boundary.
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import express, { type Express } from "express";

const PORT = Number(process.env.MOCK_EXEC_PORT ?? 4041);

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
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockExecApp };
