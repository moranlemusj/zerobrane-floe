import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { safelyRun } from "../safely-run";

const silentLog = pino({ level: "silent" });

describe("safelyRun", () => {
  it("returns normally when the wrapped fn resolves", async () => {
    let called = false;
    await safelyRun("ok", silentLog, async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("catches thrown errors and does NOT propagate them", async () => {
    // A transient Neon `fetch failed` inside an onLogs callback used to
    // bubble out of viem's watcher and kill the process. safelyRun must
    // swallow it so the next tick / reconcile can recover.
    await expect(
      safelyRun("matcher-batch", silentLog, async () => {
        throw new Error("fetch failed");
      }),
    ).resolves.toBeUndefined();
  });

  it("logs an error when the wrapped fn throws, with the provided label", async () => {
    const errorSpy = vi.fn();
    const log = { error: errorSpy } as unknown as pino.Logger;

    await safelyRun("oracle-tick", log, async () => {
      throw new Error("boom");
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const call = errorSpy.mock.calls[0]!;
    expect(call[0]).toMatchObject({ err: "boom", label: "oracle-tick" });
    expect(typeof call[1]).toBe("string");
  });
});
