import { describe, expect, it, vi } from "vitest";

import { startCronBootstrap } from "../../../src/framework/cron/cron-bootstrap.js";
import { defaultTestCronTargetAgentIds } from "../../helpers/cron-fixtures.js";
import { createCronRepositoryFake } from "../../helpers/cron-repository-fake.js";
import type { CronJobDefinition } from "../../../src/framework/cron/types.js";
import type { RuntimeCronService } from "../../../src/framework/cron/runtime-cron-service.js";

describe("startCronBootstrap", () => {
  const cronTargetAgentIds = defaultTestCronTargetAgentIds();

  const createRuntimeCronMock = (): RuntimeCronService & {
    addJob: ReturnType<typeof vi.fn>;
    removeJob: ReturnType<typeof vi.fn>;
    listActiveJobs: ReturnType<typeof vi.fn>;
  } => ({
    addJob: vi.fn().mockResolvedValue(undefined),
    removeJob: vi.fn().mockResolvedValue(undefined),
    listActiveJobs: vi.fn().mockReturnValue([]),
    stopAll: vi.fn().mockResolvedValue(undefined),
  });

  const createRepository = (jobs: CronJobDefinition[]) => {
    const repository = createCronRepositoryFake(jobs);
    repository.loadJobs = vi.fn().mockResolvedValue(jobs);
    return repository;
  };

  it("rejects invalid cron jobs even when scheduling is disabled", async () => {
    const repository = createRepository([
      {
        jobName: "",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);

    await expect(
      startCronBootstrap({
        repository,
        config: {
          schedulerEnabled: false,
        },
        runtimeCron: createRuntimeCronMock(),
        cronTargetAgentIds,
      }),
    ).rejects.toThrow(/cron job name is required/i);

    expect(repository.loadJobs).toHaveBeenCalledTimes(1);
  });

  it("validates jobs before scheduling and skips scheduling when disabled", async () => {
    const repository = createRepository([
      {
        jobName: "daily-report",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    const runtimeCron = createRuntimeCronMock();

    const jobs = await startCronBootstrap({
      repository,
      config: {
        schedulerEnabled: false,
      },
      runtimeCron,
      cronTargetAgentIds,
    });

    expect(jobs).toEqual([
      {
        jobName: "daily-report",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    expect(runtimeCron.addJob).not.toHaveBeenCalled();
    expect(repository.loadJobs).toHaveBeenCalledTimes(1);
  });

  it("registers validated jobs through RuntimeCronService when enabled", async () => {
    const repository = createRepository([
      {
        jobName: "daily-report",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    const runtimeCron = createRuntimeCronMock();

    const jobs = await startCronBootstrap({
      repository,
      config: {
        schedulerEnabled: true,
      },
      runtimeCron,
      cronTargetAgentIds,
    });

    expect(jobs).toEqual([
      {
        jobName: "daily-report",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    expect(runtimeCron.addJob).toHaveBeenCalledTimes(1);
    expect(runtimeCron.addJob).toHaveBeenCalledWith({
      jobName: "daily-report",
      schedule: "59 23 * * *",
      targetRoute: "finance",
    });
  });

  it("skips disabled jobs during bootstrap registration", async () => {
    const repository = createRepository([
      {
        jobName: "daily-report",
        schedule: "59 23 * * *",
        targetRoute: "finance",
        enabled: false,
      },
    ]);
    const runtimeCron = createRuntimeCronMock();

    await startCronBootstrap({
      repository,
      config: {
        schedulerEnabled: true,
      },
      runtimeCron,
      cronTargetAgentIds,
    });

    expect(runtimeCron.addJob).not.toHaveBeenCalled();
  });
});
