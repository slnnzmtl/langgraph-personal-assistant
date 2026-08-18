import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scheduleMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: scheduleMock,
  },
}));

import {
  createRuntimeCronService,
  type RuntimeCronService,
} from "../../../src/framework/cron/runtime-cron-service.js";

describe("createRuntimeCronService", () => {
  let service: RuntimeCronService | undefined;

  beforeEach(() => {
    scheduleMock.mockReset();
    scheduleMock.mockReturnValue({
      stop: vi.fn(),
      destroy: vi.fn(),
    });
  });

  afterEach(async () => {
    await service?.stopAll();
    service = undefined;
  });

  it("schedules jobs with name, timezone, and a large missedExecutionTolerance", async () => {
    const runner = vi.fn();
    service = createRuntimeCronService({
      runner,
      timezone: "Asia/Ho_Chi_Minh",
    });

    await service.addJob({
      jobName: "sync-finance",
      schedule: "1 0 * * *",
      targetRoute: "finance",
    });

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith(
      "1 0 * * *",
      expect.any(Function),
      {
        name: "sync-finance",
        timezone: "Asia/Ho_Chi_Minh",
        missedExecutionTolerance: 24 * 60 * 60 * 1000,
      },
    );
  });

  it("prefers per-job timezone overrides", async () => {
    service = createRuntimeCronService({
      runner: vi.fn(),
      timezone: "UTC",
    });

    await service.addJob({
      jobName: "routine-note-creation",
      schedule: "0 8 * * *",
      targetRoute: "obsidian",
      timezone: "Asia/Ho_Chi_Minh",
    });

    expect(scheduleMock).toHaveBeenCalledWith(
      "0 8 * * *",
      expect.any(Function),
      expect.objectContaining({
        name: "routine-note-creation",
        timezone: "Asia/Ho_Chi_Minh",
        missedExecutionTolerance: 24 * 60 * 60 * 1000,
      }),
    );
  });
});
