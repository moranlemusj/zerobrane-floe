/**
 * Shared helpers for the code-execution example. Used by both the runnable
 * agent demo (`run.ts`) and the automated mocked e2e test
 * (`src/__tests__/example-wiring.test.ts`).
 */

import type { Server } from "node:http";
import type express from "express";
import { mockExecApp } from "./mock-exec.js";
import { mockFloeApp, mockFloeState } from "./mock-floe.js";

export interface MockEndpoints {
  floeBaseUrl: string;
  execBaseUrl: string;
  floePort: number;
  execPort: number;
  stop: () => Promise<void>;
}

/**
 * Spawn mock-floe and mock-exec in-process on ephemeral ports.
 * Wire them so mock-exec settles debits via the just-spawned mock-floe.
 */
export async function startMockServers(): Promise<MockEndpoints> {
  // Reset mock-floe state in case a prior run left it dirty.
  mockFloeState.creditOut = 0n;
  mockFloeState.sessionSpent = 0n;
  mockFloeState.sessionSpendLimit = null;

  const floeServer = await listenOn(mockFloeApp, 0);
  const floePort = (floeServer.address() as { port: number }).port;
  const floeBaseUrl = `http://127.0.0.1:${floePort}`;

  // mock-exec reads MOCK_FLOE_URL at handler call-time via fetch, so set it now.
  process.env.MOCK_FLOE_URL = floeBaseUrl;

  const execServer = await listenOn(mockExecApp, 0);
  const execPort = (execServer.address() as { port: number }).port;
  const execBaseUrl = `http://127.0.0.1:${execPort}`;

  return {
    floeBaseUrl,
    execBaseUrl,
    floePort,
    execPort,
    stop: async () => {
      await Promise.all([closeServer(floeServer), closeServer(execServer)]);
    },
  };
}

function listenOn(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Read the mock-floe ledger snapshot.
 */
export async function getMockState(floeBaseUrl: string): Promise<{
  creditLimit: string;
  creditOut: string;
  sessionSpent: string;
  sessionSpendLimit: string | null;
  available: string;
  headroomToAutoBorrow: string;
  utilizationBps: number;
}> {
  const res = await fetch(`${floeBaseUrl}/__mock/state`);
  return (await res.json()) as {
    creditLimit: string;
    creditOut: string;
    sessionSpent: string;
    sessionSpendLimit: string | null;
    available: string;
    headroomToAutoBorrow: string;
    utilizationBps: number;
  };
}

/**
 * Helper: extract `{ url, method }` from a `run_code`-style tool input
 * for the floeCreditPreflight extractor. Used in both the demo and tests.
 */
export function extractRunCodeUrl(execBaseUrl: string) {
  return (toolName: string, _input: unknown): { url: string; method?: string } | null => {
    if (!toolName.includes("run_code")) return null;
    return { url: `${execBaseUrl}/exec`, method: "POST" };
  };
}
