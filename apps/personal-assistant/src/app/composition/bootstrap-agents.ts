import type { AppConfig } from "../../config.js";
import {
  resolveAgentCapabilityIds,
  SYSTEM_AGENT_ID,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { OBSIDIAN_VAULT_CAPABILITY_ID } from "../policies/generic-runtime-policy.js";

/** @deprecated Use SYSTEM_AGENT_ID from @personal-assistant/supervisor-framework */
export const CONFIGURATOR_AGENT_ID = SYSTEM_AGENT_ID;

const LEGACY_CAPABILITY_EXECUTORS: Record<string, string> = {
  obsidian: OBSIDIAN_VAULT_CAPABILITY_ID,
};

/** Map legacy domain executors to generic when the matching capability is already granted. */
export const normalizeLegacyExecutors = (
  agents: RuntimeAgentDefinition[],
): RuntimeAgentDefinition[] =>
  agents.map((agent) => {
    const executor = agent.executor ?? "generic";
    if (executor === "generic") {
      return agent;
    }

    const capabilityId = LEGACY_CAPABILITY_EXECUTORS[executor];
    if (capabilityId && resolveAgentCapabilityIds(agent).includes(capabilityId)) {
      return { ...agent, executor: "generic" };
    }

    return agent;
  });

type AppModelConfigKey = keyof Pick<
  AppConfig,
  "financeModel" | "obsidianModel" | "configurationModel"
>;

const resolveModelConfigKey = (modelKey: string): AppModelConfigKey | undefined => {
  const candidate = `${modelKey}Model`;
  if (candidate === "financeModel" || candidate === "obsidianModel" || candidate === "configurationModel") {
    return candidate;
  }

  return undefined;
};

export const resolveBuiltinModelName = (config: AppConfig, modelKey: string): string => {
  if (modelKey === "generic") {
    return config.obsidianModel;
  }

  const configKey = resolveModelConfigKey(modelKey);
  if (configKey) {
    return config[configKey];
  }

  return config.geminiModel;
};

export type LocalModuleAvailabilityOptions = {
  supabaseAvailable?: boolean;
};

export const applyLocalModuleAvailability = (
  agents: RuntimeAgentDefinition[],
  options: LocalModuleAvailabilityOptions = {},
): RuntimeAgentDefinition[] => {
  const normalizedAgents = normalizeLegacyExecutors(agents);

  if (options.supabaseAvailable !== false) {
    return normalizedAgents;
  }

  return normalizedAgents.map((agent) => {
    if (resolveAgentCapabilityIds(agent).includes("finance-domain")) {
      return {
        ...agent,
        enabled: false,
      };
    }

    return agent;
  });
};
