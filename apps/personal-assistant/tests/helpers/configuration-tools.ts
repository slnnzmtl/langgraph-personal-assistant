import { vi } from "vitest";

import {
  createSystemConfigTools,
  SYSTEM_AGENT_ID,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityCatalog } from "./capability-catalog.js";
import { createReadSkillTool } from "@personal-assistant/supervisor-framework";
import { createTestSkillCatalog } from "./test-skills-dir.js";
import type { CronJobDefinition, CronJobRepository } from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../../src/runtime-agents/capabilities.js";
import { createRuntimeAgentRepositoryFake, defaultConfigurationCapabilityDeps } from "./fakes.js";

const defaultConfigurationCatalog = createPersonalCapabilityCatalog();

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
  capabilityDepsOverrides: Partial<PersonalCapabilityDeps> = {},
) => {
  const capabilityDeps = {
    ...defaultConfigurationCapabilityDeps,
    cronJobRepository: repository,
    runtimeAgentRepository,
    capabilityCatalog: defaultConfigurationCatalog,
    skillCatalog: createTestSkillCatalog([skillModule, "finance", "obsidian"]),
    ...capabilityDepsOverrides,
  };

  return [
    createReadSkillTool(skillModule, "xml", { skillCatalog: createTestSkillCatalog([skillModule, "finance", "obsidian"]) }),
    ...createSystemConfigTools(capabilityDeps),
  ];
};
