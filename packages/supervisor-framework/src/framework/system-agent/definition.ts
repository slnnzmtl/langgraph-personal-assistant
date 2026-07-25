import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { SystemAgentOptions } from "./types.js";

/** Virtual system admin agent id (skill module + executor name). */
export const SYSTEM_AGENT_ID = "configuration" as const;

export const SYSTEM_AGENT_DISPLAY_NAME = "Configuration";

export const SYSTEM_AGENT_EPOCH = "1970-01-01T00:00:00.000Z";

export const SYSTEM_CONFIG_CAPABILITY_ID = "system-config" as const;

export const SYSTEM_CONFIG_READ_CAPABILITY_ID = "system-config-read" as const;

export const isSystemAgentId = (id: string): id is typeof SYSTEM_AGENT_ID =>
  id === SYSTEM_AGENT_ID;

export const createSystemAgentDefinition = (
  options: SystemAgentOptions,
): RuntimeAgentDefinition => {
  const modelKey = options.modelKey ?? SYSTEM_AGENT_ID;

  return {
    id: SYSTEM_AGENT_ID,
    name: SYSTEM_AGENT_DISPLAY_NAME,
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
