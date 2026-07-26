import { vi } from "vitest";

import {
  createSystemConfigTools,
  mergeCapabilityCatalogs,
  SYSTEM_AGENT_ID,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityProviders } from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";
import type { CronJobDefinition, CronJobRepository } from "../../src/cron/types.js";
import { createReadSkillTool } from "../../src/runtime-agents/skills/skill-management.js";
import { createRuntimeAgentRepositoryFake, defaultConfigurationCapabilityDeps } from "./fakes.js";

const defaultConfigurationCatalog = mergeCapabilityCatalogs(
  createPersonalCapabilityProviders() as never,
  true,
);

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
  skillModule: string = SYSTEM_AGENT_ID,
) => {
  const capabilityDeps = {
    ...defaultConfigurationCapabilityDeps,
    cronJobRepository: repository,
    runtimeAgentRepository,
    capabilityCatalog: defaultConfigurationCatalog,
    skillCatalog: createSkillCatalog({ approvedModules: [skillModule, "finance", "obsidian"] }),
  };

  return [
    createReadSkillTool(skillModule, "xml"),
    ...createSystemConfigTools(capabilityDeps),
  ];
};
