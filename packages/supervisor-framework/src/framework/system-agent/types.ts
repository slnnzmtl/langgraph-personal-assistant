import type { CapabilityCatalog } from "../../capabilities/index.js";
import type { CronJobRepository } from "../types.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";

export type SystemCronJob = {
  jobName: string;
  schedule: string;
  targetRoute: string;
  timezone?: string;
  payload?: unknown;
};

export type SystemConfigDeps = {
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  cronTargetAgentIds?: readonly string[];
  skillCatalog?: SkillCatalog;
  capabilityCatalog?: CapabilityCatalog;
};

export type SystemAgentOptions = {
  prompt: () => string;
  modelKey?: string;
  maxSteps?: number;
  onCronMutated?: () => Promise<void>;
};

export type SystemConfigToolsOptions = {
  writeAccess?: boolean;
  skillCatalog?: SkillCatalog;
  capabilityCatalog?: CapabilityCatalog;
  cronTargetAgentIds?: readonly string[];
  validateCronTargetRoute?: (route: string, allowedRoutes: readonly string[]) => boolean;
};
