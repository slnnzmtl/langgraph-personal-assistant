import type { AppConfig } from "../config.js";
import {
  DEFAULT_MODEL_KEY,
  resolveAgentCapabilityIds,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";

const MODEL_OVERRIDES: Record<string, (config: AppConfig) => string> = {
  finance: (config) => config.financeModel,
  obsidian: (config) => config.obsidianModel,
  configuration: (config) => config.configurationModel,
};

export const resolveBuiltinModelName = (config: AppConfig, modelKey: string): string =>
  MODEL_OVERRIDES[modelKey]?.(config) ?? config.geminiModel;

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
