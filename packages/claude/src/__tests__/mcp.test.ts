import { describe, expect, it } from "vitest";
import {
  FLOE_AGENT_AWARENESS_TOOLS,
  FLOE_CAPITAL_MOVING_TOOLS,
  FLOE_MCP_SERVER_KEY,
  FLOE_READ_TOOLS,
  FLOE_TOOLS_ALL,
  FLOE_WRITE_TOOLS,
  floeMcpHttp,
  floeMcpServers,
  floeMcpStdio,
} from "../mcp.js";

describe("constants", () => {
  it("FLOE_MCP_SERVER_KEY is 'floe'", () => {
    expect(FLOE_MCP_SERVER_KEY).toBe("floe");
  });
  it("FLOE_TOOLS_ALL is the glob over Floe MCP tools", () => {
    expect(FLOE_TOOLS_ALL).toBe("mcp__floe__*");
  });
  it("all tool names are prefixed with mcp__floe__", () => {
    for (const t of [
      ...FLOE_READ_TOOLS,
      ...FLOE_WRITE_TOOLS,
      ...FLOE_CAPITAL_MOVING_TOOLS,
      ...FLOE_AGENT_AWARENESS_TOOLS,
    ]) {
      expect(t.startsWith("mcp__floe__")).toBe(true);
    }
  });
  it("FLOE_CAPITAL_MOVING_TOOLS is a subset of FLOE_WRITE_TOOLS plus broadcast_transaction", () => {
    const writes = new Set(FLOE_WRITE_TOOLS);
    for (const t of FLOE_CAPITAL_MOVING_TOOLS) {
      const isWrite = writes.has(t);
      const isBroadcast = t === "mcp__floe__broadcast_transaction";
      expect(isWrite || isBroadcast).toBe(true);
    }
  });
});

describe("floeMcpHttp", () => {
  it("returns a typed HTTP MCP server config with Bearer auth", () => {
    const cfg = floeMcpHttp({ apiKey: "floe_live_test" });
    expect(cfg.type).toBe("http");
    expect(cfg.url).toBe("https://mcp.floelabs.xyz/mcp");
    expect(cfg.headers.Authorization).toBe("Bearer floe_live_test");
  });
  it("respects custom URL (mock servers, staging)", () => {
    const cfg = floeMcpHttp({ apiKey: "x", url: "http://localhost:3100/mcp" });
    expect(cfg.url).toBe("http://localhost:3100/mcp");
  });
  it("merges extra headers", () => {
    const cfg = floeMcpHttp({ apiKey: "x", extraHeaders: { "X-Trace": "abc" } });
    expect(cfg.headers["X-Trace"]).toBe("abc");
    expect(cfg.headers.Authorization).toBe("Bearer x");
  });
  it("throws when apiKey is missing", () => {
    expect(() => floeMcpHttp({ apiKey: "" })).toThrow();
  });
});

describe("floeMcpStdio", () => {
  it("defaults to npx -y @floelabs/mcp-server with FLOE_API_KEY env", () => {
    const cfg = floeMcpStdio({ apiKey: "floe_live_test" });
    expect(cfg.type).toBe("stdio");
    expect(cfg.command).toBe("npx");
    expect(cfg.args).toEqual(["-y", "@floelabs/mcp-server"]);
    expect(cfg.env.FLOE_API_KEY).toBe("floe_live_test");
  });
  it("accepts custom packageName", () => {
    const cfg = floeMcpStdio({ apiKey: "x", packageName: "@my/fork" });
    expect(cfg.args).toEqual(["-y", "@my/fork"]);
  });
  it("accepts fully custom command + args", () => {
    const cfg = floeMcpStdio({
      apiKey: "x",
      command: "node",
      args: ["/path/to/server.js"],
    });
    expect(cfg.command).toBe("node");
    expect(cfg.args).toEqual(["/path/to/server.js"]);
  });
  it("merges extra env", () => {
    const cfg = floeMcpStdio({ apiKey: "x", extraEnv: { LOG_LEVEL: "debug" } });
    expect(cfg.env.LOG_LEVEL).toBe("debug");
    expect(cfg.env.FLOE_API_KEY).toBe("x");
  });
});

describe("floeMcpServers", () => {
  it("wraps a single config under the 'floe' key", () => {
    const cfg = floeMcpHttp({ apiKey: "x" });
    const servers = floeMcpServers(cfg);
    expect(Object.keys(servers)).toEqual(["floe"]);
    expect(servers.floe).toBe(cfg);
  });
});
