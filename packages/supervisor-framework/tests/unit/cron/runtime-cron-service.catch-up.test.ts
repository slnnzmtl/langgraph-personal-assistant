import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeCronService,
  type RuntimeCronService,
} from "../../../src/framework/cron/runtime-cron-service.js";

describe("createRuntimeCronService clock-jump catch-up", () => {
  let service: RuntimeCronService | undefined;

  afterEach(async () => {
    await service?.stopAll();
    service = undefined;
    vi.useRealTimers();
  });

  it("runs one missed daily slot after a wall-clock jump without flushing the long timeout", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-18T11:00:00.000Z") });
    const runner = vi.fn().mockResolvedValue(undefined);
    service = createRuntimeCronService({
      runner,
      timezone: "UTC",
    });

    await service.addJob({
      jobName: "noon-summary",
      schedule: "0 12 * * *",
      targetRoute: "finance",
    });

    expect(runner).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-08-18T15:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith({
      jobName: "noon-summary",
      trigger: "SYSTEM_CRON_TRIGGER:finance:noon-summary",
    });

    vi.setSystemTime(new Date("2026-08-18T19:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("catch-up runs the next day's slot after a later clock jump", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-18T11:00:00.000Z") });
    const runner = vi.fn().mockResolvedValue(undefined);
    service = createRuntimeCronService({
      runner,
      timezone: "UTC",
    });

    await service.addJob({
      jobName: "noon-summary",
      schedule: "0 12 * * *",
      targetRoute: "finance",
    });

    vi.setSystemTime(new Date("2026-08-18T15:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));

    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
  });

  it("runs a due slot on the regular poll without a clock jump", async () => {
    let nowMs = Date.parse("2026-08-18T11:00:00.000Z");
    vi.useFakeTimers({ now: nowMs });
    const runner = vi.fn().mockResolvedValue(undefined);
    service = createRuntimeCronService({
      runner,
      timezone: "UTC",
      getLastRunAt: () => new Date("2026-08-17T12:00:05.000Z"),
    });

    await service.addJob({
      jobName: "noon-summary",
      schedule: "0 12 * * *",
      targetRoute: "finance",
    });

    // Step wall clock by <60s each sample so reconcile runs as "poll", not "clock-jump".
    // Do not flush node-cron's long timeout: only advance the 30s sampler.
    for (let i = 0; i < 90; i += 1) {
      nowMs += 50_000;
      vi.setSystemTime(nowMs);
      await vi.advanceTimersByTimeAsync(30_000);
      if (runner.mock.calls.length > 0) {
        break;
      }
    }

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith({
      jobName: "noon-summary",
      trigger: "SYSTEM_CRON_TRIGGER:finance:noon-summary",
    });
  });
});
