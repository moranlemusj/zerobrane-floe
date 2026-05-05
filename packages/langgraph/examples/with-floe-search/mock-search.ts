/**
 * mock-search — plain paid-search endpoint.
 *
 * Returns hand-crafted search results. **Performs no settlement of its
 * own.** The agent reaches this endpoint via Floe's facilitator
 * (`mock-floe`'s `/v1/proxy/fetch`), which debits + forwards. From this
 * server's perspective, the call has already been paid for.
 *
 * Demo only.
 */

import { fileURLToPath } from "node:url";
import express, { type Express } from "express";

const PORT = Number(process.env.MOCK_SEARCH_PORT ?? 4042);

const app: Express = express();
app.use(express.json({ limit: "100kb" }));

app.post("/search", (req, res) => {
  const { query } = (req.body ?? {}) as { query?: string };
  if (typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "query (string) required" });
  }
  const results = [
    {
      title: `Floe is great — about ${query}`,
      url: "https://floe-labs.gitbook.io/docs",
      snippet: `Hand-fabricated result about ${query}.`,
    },
    {
      title: `Another result about ${query}`,
      url: "https://example.com/x",
      snippet: "Lorem ipsum for the demo.",
    },
  ];
  res.json({ query, results });
});

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  const server = app.listen(PORT, () => {
    console.log(`[mock-search] listening on http://localhost:${PORT}`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

export { app as mockSearchApp };
