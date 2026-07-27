import { describe, expect, it, vi } from "vitest";

import { reconcileRuntimeCron } from "../../src/cron/reconcile-runtime-cron.js";
import { createCronRepositoryFake } from "../helpers/configuration-tools.js";
import type { CronJobDefinition } from "../../src/cron/cron-launcher.js";
import type { RuntimeCronService } from "../../src/cron/types.js";

const dailyReportJob: CronJobDefinition = {
  jobName: "daily-report",
  schedule: "59 23 * * *",
  targetRoute: "finance",
};

describe("reconcileRuntimeCron", () => {
  const createRepository = (jobs: CronJobDefinition[]) => {
    const repository = createCronRepositoryFake(jobs);
    repository.loadJobs = vi.fn().mockResolvedValue(jobs);
    return repository;
  };

  it("does not duplicate jobs already registered during bootstrap", async () => {
    const repository = createRepository([dailyReportJob]);
    const runtimeCron: RuntimeCronService = {
      addJob: vi.fn().mockResolvedValue(undefined),
      removeJob: vi.fn().mockResolvedValue(undefined),
      listActiveJobs: vi.fn().mockReturnValue([dailyReportJob]),
    };

    await reconcileRuntimeCron(repository, runtimeCron);

    expect(runtimeCron.addJob).not.toHaveBeenCalled();
    expect(runtimeCron.removeJob).not.toHaveBeenCalled();
  });

  it("updates changed schedules in place", async () => {
    const updatedJob: CronJobDefinition = {
      ...dailyReportJob,
      schedule: "0 1 * * *",
    };
    const repository = createRepository([updatedJob]);
    const runtimeCron: RuntimeCronService = {
      addJob: vi.fn().mockResolvedValue(undefined),
      removeJob: vi.fn().mockResolvedValue(undefined),
      listActiveJobs: vi.fn()
        .mockReturnValueOnce([dailyReportJob])
        .mockReturnValueOnce([]),
    };

    await reconcileRuntimeCron(repository, runtimeCron);

    expect(runtimeCron.removeJob).toHaveBeenCalledWith("daily-report");
    expect(runtimeCron.addJob).toHaveBeenCalledWith(updatedJob);
  });

  it("adds jobs that were not registered during bootstrap", async () => {
    const repository = createRepository([dailyReportJob]);
    const runtimeCron: RuntimeCronService = {
      addJob: vi.fn().mockResolvedValue(undefined),
      removeJob: vi.fn().mockResolvedValue(undefined),
      listActiveJobs: vi.fn().mockReturnValue([]),
    };

    await reconcileRuntimeCron(repository, runtimeCron);

    expect(runtimeCron.addJob).toHaveBeenCalledWith(dailyReportJob);
    expect(runtimeCron.removeJob).not.toHaveBeenCalled();
  });
});
