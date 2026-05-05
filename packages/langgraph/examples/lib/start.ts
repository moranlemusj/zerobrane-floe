/**
 * Shared helpers for spawning mock servers in-process for tests / demos.
 */

import type { Server } from "node:http";
import type { Express } from "express";
import { mockFloeApp, mockFloeState } from "./mock-floe.js";
import { mockSearchApp } from "../with-floe-search/mock-search.js";

export interface MockEndpoints {
  floeBaseUrl: string;
  searchBaseUrl: string;
  /** Set when `withAgentExec: true` was passed. */
  execBaseUrl?: string;
  stop: () => Promise<void>;
}

export interface StartMockServersOptions {
  /** Also spin up the agent demo's mock-x402-exec endpoint. */
  withAgentExec?: boolean;
}

export async function startMockServers(
  opts: StartMockServersOptions = {},
): Promise<MockEndpoints> {
  mockFloeState.creditOut = 0n;
  mockFloeState.sessionSpent = 0n;
  mockFloeState.sessionSpendLimit = null;

  const floeServer = await listen(mockFloeApp);
  const floePort = (floeServer.address() as { port: number }).port;
  const floeBaseUrl = `http://127.0.0.1:${floePort}`;

  const searchServer = await listen(mockSearchApp);
  const searchPort = (searchServer.address() as { port: number }).port;

  const servers: Server[] = [floeServer, searchServer];
  let execBaseUrl: string | undefined;

  if (opts.withAgentExec) {
    // Lazy import so the agent example's mock isn't pulled into builds that don't need it.
    const { mockX402ExecApp } = await import("../agent/mock-x402-exec.js");
    const execServer = await listen(mockX402ExecApp);
    const execPort = (execServer.address() as { port: number }).port;
    execBaseUrl = `http://127.0.0.1:${execPort}`;
    servers.push(execServer);
  }

  const result: MockEndpoints = {
    floeBaseUrl,
    searchBaseUrl: `http://127.0.0.1:${searchPort}`,
    stop: async () => {
      await Promise.all(servers.map(close));
    },
  };
  if (execBaseUrl) result.execBaseUrl = execBaseUrl;
  return result;
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
