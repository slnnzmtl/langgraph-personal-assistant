import type { CapabilityCatalog } from "../../capabilities/index.js";
import { configurationReposAvailable } from "../../capabilities/index.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import type { RuntimeAgentExecutionContext } from "../../core/execution/context.js";
import {
  CONFIGURATION_AGENT_ID,
  resolveAgentCapabilityIds,
  type RuntimeAgentDefinition,
} from "../../core/types/agent.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import type { CronJobRepository } from "../types.js";

/** Virtual system admin agent id (skill module + executor name). */
export const SYSTEM_AGENT_ID = CONFIGURATION_AGENT_ID;

export const SYSTEM_AGENT_DISPLAY_NAME = "Configuration";

export const SYSTEM_AGENT_EPOCH = "1970-01-01T00:00:00.000Z";

export const SYSTEM_CONFIG_CAPABILITY_ID = "system-config" as const;

export const SYSTEM_CONFIG_READ_CAPABILITY_ID = "system-config-read" as const;

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
  modelKey?: string;
  maxSteps?: number;
};

export type SystemConfigToolsOptions = {
  writeAccess?: boolean;
  skillCatalog?: SkillCatalog;
  capabilityCatalog?: CapabilityCatalog;
  cronTargetAgentIds?: readonly string[];
  validateCronTargetRoute?: (route: string, allowedRoutes: readonly string[]) => boolean;
};

const SYSTEM_AGENT_BOOTSTRAP_PROMPT =
  "Runtime prompt is loaded from agents/configuration.xml via promptSourceKey.";

export const isSystemAgentId = (id: string): id is typeof SYSTEM_AGENT_ID =>
  id === SYSTEM_AGENT_ID;

export const createSystemAgentDefinition = (
  options: SystemAgentOptions = {},
): RuntimeAgentDefinition => {
  const modelKey = options.modelKey ?? SYSTEM_AGENT_ID;

  return {
    id: SYSTEM_AGENT_ID,
    name: SYSTEM_AGENT_DISPLAY_NAME,
    description: "Manage cron jobs, agent skills, and reusable runtime sub-agents.",
    systemPrompt: SYSTEM_AGENT_BOOTSTRAP_PROMPT,
    promptSourceKey: SYSTEM_AGENT_ID,
    capabilityIds: [SYSTEM_CONFIG_CAPABILITY_ID],
    executor: CONFIGURATION_AGENT_ID,
    modelKey,
    builtin: true,
    maxSteps: options.maxSteps ?? 10,
    enabled: true,
    createdAt: SYSTEM_AGENT_EPOCH,
    updatedAt: SYSTEM_AGENT_EPOCH,
  };
};

export const hasSystemConfigWriteCapability = (
  definition: Pick<RuntimeAgentDefinition, "id" | "capabilityIds">,
): boolean =>
  isSystemAgentId(definition.id)
  || resolveAgentCapabilityIds(definition).includes(SYSTEM_CONFIG_CAPABILITY_ID);

export const resolveSystemConfigDeps = (
  context: RuntimeAgentExecutionContext<SystemConfigDeps>,
  definition: RuntimeAgentDefinition,
): Record<string, never> | null => {
  if (!hasSystemConfigWriteCapability(definition)) {
    return {};
  }

  return configurationReposAvailable(context.capabilityDeps) ? {} : null;
};

export const SYSTEM_CONFIG_UNAVAILABLE_MESSAGE =
  "Configuration is unavailable because cron and runtime agent storage are not configured.";
