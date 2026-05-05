/**
 * Shared helpers for spawning mock servers in-process for tests / demos.
 */

import type { Server } from "node:http";
import type { Express } from "express";
import { mockX402ExecApp } from "../code-exec/mock-x402-exec.js";
import { mockFloeApp, mockFloeState } from "./mock-floe.js";
import { mockSearchApp } from "../with-floe-search/mock-search.js";

export interface MockEndpoints {
  floeBaseUrl: string;
  searchBaseUrl: string;
  execBaseUrl: string;
  stop: () => Promise<void>;
}

export async function startMockServers(): Promise<MockEndpoints> {
  mockFloeState.creditOut = 0n;
  mockFloeState.sessionSpent = 0n;
  mockFloeState.sessionSpendLimit = null;

  const floeServer = await listen(mockFloeApp);
  const floePort = (floeServer.address() as { port: number }).port;
  const floeBaseUrl = `http://127.0.0.1:${floePort}`;

  // search + exec endpoints read MOCK_FLOE_URL on each request.
  process.env.MOCK_FLOE_URL = floeBaseUrl;

  const searchServer = await listen(mockSearchApp);
  const searchPort = (searchServer.address() as { port: number }).port;

  const execServer = await listen(mockX402ExecApp);
  const execPort = (execServer.address() as { port: number }).port;

  return {
    floeBaseUrl,
    searchBaseUrl: `http://127.0.0.1:${searchPort}`,
    execBaseUrl: `http://127.0.0.1:${execPort}`,
    stop: async () => {
      await Promise.all([
        close(floeServer),
        close(searchServer),
        close(execServer),
      ]);
    },
  };
}

function listen(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function getMockState(floeBaseUrl: string) {
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
