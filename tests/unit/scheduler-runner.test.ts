import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createSchedulerRunner } from "../../src/cron/scheduler-runner.js";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("createSchedulerRunner", () => {
  it("creates a unique thread id for each scheduled run", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createSchedulerRunner({ graph: { invoke }, onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });

    expect(invoke).toHaveBeenCalledTimes(2);

    const firstConfig = invoke.mock.calls[0]?.[1];
    const secondConfig = invoke.mock.calls[1]?.[1];

    expect(firstConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(secondConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(firstConfig?.configurable?.thread_id).not.toBe(secondConfig?.configurable?.thread_id);
  });

  it("sends a synthetic human message with the scheduled trigger content", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createSchedulerRunner({ graph: { invoke }, onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });

    expect(invoke).toHaveBeenCalledTimes(1);

    const input = invoke.mock.calls[0]?.[0];
    expect(input?.messages).toHaveLength(1);
    expect(input?.messages[0]).toBeInstanceOf(HumanMessage);
    expect(input?.messages[0]?.content).toBe("SYSTEM_CRON_TRIGGER:finance-sync");
  });

  it("skips overlapping runs for the same job while a prior run is still active", async () => {
    const inFlight = deferred<void>();
    const invoke = vi.fn().mockReturnValue(inFlight.promise);
    const runner = createSchedulerRunner({ graph: { invoke }, onError: vi.fn() });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await Promise.resolve();

    await expect(
      runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" }),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;
  });

  it("captures graph errors without throwing from the scheduled callback", async () => {
    const error = new Error("graph failed");
    const invoke = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const runner = createSchedulerRunner({ graph: { invoke }, onError });

    await expect(
      runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: "SYSTEM_CRON_TRIGGER:finance-sync",
      }),
    );
  });

  it("allows later runs after an in-flight execution settles", async () => {
    const inFlight = deferred<void>();
    const invoke = vi
      .fn()
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValueOnce(undefined);
    const runner = createSchedulerRunner({ graph: { invoke }, onError: vi.fn() });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await Promise.resolve();

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});