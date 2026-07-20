import { vi } from "vitest";

import { createConfigurationTools as createConfigurationToolsImpl } from "../../src/runtime-agents/policies/configuration/tools.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import type { CronJobDefinition, CronJobRepository } from "../../src/cron/types.js";
import { createRuntimeAgentRepositoryFake, defaultConfigurationBundleDeps } from "./fakes.js";

export const createCronRepositoryFake = (
  initialJobs: CronJobDefinition[] = [],
): CronJobRepository => {
  let storedJobs = [...initialJobs];

  return {
    loadJobs: vi.fn(async () => storedJobs),
    saveJobs: vi.fn(async (nextJobs) => {
      storedJobs = [...nextJobs];
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
