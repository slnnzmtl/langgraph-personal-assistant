import { vi } from "vitest";

import { createConfigurationTools as createConfigurationToolsImpl } from "../../src/runtime-agents/policies/configuration/tools.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import type { CronJobDefinition, CronJobRepository } from "../../src/cron/types.js";
import { createRuntimeAgentRepositoryFake, defaultConfigurationBundleDeps } from "./fakes.js";

export const createCronRepositoryFake = (
  initialJobs: CronJobDefinition[] = [],
): CronJobRepository => {
  let storedJobs = [...initialJobs];

  const reload = (): CronJobDefinition[] => [...storedJobs];

  return {
    loadJobs: vi.fn(async () => reload()),
    saveJobs: vi.fn(async (nextJobs) => {
      storedJobs = [...nextJobs];
    }),
    createJob: vi.fn(async (job) => {
      if (storedJobs.some((existing) => existing.jobName === job.jobName)) {
        throw new Error(`Cron job already exists: ${job.jobName}`);
      }
      storedJobs = [...storedJobs, job];
      return job;
    }),
    deleteJob: vi.fn(async (jobName) => {
      const found = storedJobs.find((job) => job.jobName === jobName);
      if (!found) {
        throw new Error(`Cron job not found: ${jobName}`);
      }
      storedJobs = storedJobs.filter((job) => job.jobName !== jobName);
      return found;
    }),
  };
};

export const createConfigurationTools = (
  repository: CronJobRepository = createCronRepositoryFake(),
  runtimeAgentRepository: RuntimeAgentRepository = createRuntimeAgentRepositoryFake(),
) =>
  createConfigurationToolsImpl({
    ...defaultConfigurationBundleDeps,
    cronJobRepository: repository,
    runtimeAgentRepository,
  });
