import type { AppConfig } from "../../config.js";
import {
  resolveAgentCapabilityIds,
  SYSTEM_AGENT_ID,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";

/** @deprecated Use SYSTEM_AGENT_ID from @personal-assistant/supervisor-framework */
export const CONFIGURATOR_AGENT_ID = SYSTEM_AGENT_ID;

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
  if (options.supabaseAvailable !== false) {
    return agents;
  }

  return agents.map((agent) => {
    if (resolveAgentCapabilityIds(agent).includes("finance-domain")) {
      return {
        ...agent,
        enabled: false,
      };
    }

    return agent;
  });
};
