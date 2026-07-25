import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import {
  SYSTEM_AGENT_EPOCH,
  SYSTEM_AGENT_ID,
  SYSTEM_CONFIG_CAPABILITY_ID,
} from "./constants.js";
import type { SystemAgentOptions } from "./types.js";

export const isSystemAgentId = (id: string): id is typeof SYSTEM_AGENT_ID =>
  id === SYSTEM_AGENT_ID;

export const createSystemAgentDefinition = (
  options: SystemAgentOptions,
): RuntimeAgentDefinition => {
  const modelKey = options.modelKey ?? SYSTEM_AGENT_ID;

  return {
    id: SYSTEM_AGENT_ID,
    name: "Configuration",
    description: "Manage cron jobs, agent skills, and reusable runtime sub-agents.",
    systemPrompt: options.prompt(),
    promptSourceKey: SYSTEM_AGENT_ID,
    capabilityIds: [SYSTEM_CONFIG_CAPABILITY_ID],
    executor: SYSTEM_AGENT_ID,
    modelKey,
    builtin: true,
    maxSteps: options.maxSteps ?? 10,
    enabled: true,
    createdAt: SYSTEM_AGENT_EPOCH,
    updatedAt: SYSTEM_AGENT_EPOCH,
  };
};
