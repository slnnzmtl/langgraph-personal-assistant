import type { ModelConfig } from "../config.js";
import {
  resolveAgentCapabilityIds,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { hasFinanceCapability } from "../runtime-agents/finance/tools.js";
import { promptFileExists } from "../prompts/prompt-store.js";

const MODEL_OVERRIDES: Record<string, (config: ModelConfig) => string> = {
  finance: (config) => config.financeModel,
  obsidian: (config) => config.obsidianModel,
  configuration: (config) => config.configurationModel,
};

export const resolveBuiltinModelName = (config: ModelConfig, modelKey: string): string =>
  MODEL_OVERRIDES[modelKey]?.(config) ?? config.geminiModel;

export type IntegrationAvailabilityOptions = {
  supabaseAvailable?: boolean;
};

export const applyIntegrationAvailability = (
  agents: RuntimeAgentDefinition[],
  options: IntegrationAvailabilityOptions = {},
): RuntimeAgentDefinition[] => {
  if (options.supabaseAvailable !== false) {
    return agents;
  }

  return agents.map((agent) => {
    if (hasFinanceCapability(resolveAgentCapabilityIds(agent))) {
      return {
        ...agent,
        enabled: false,
      };
    }

    return agent;
  });
};

export const applyPromptFileAvailability = (
  agents: RuntimeAgentDefinition[],
): RuntimeAgentDefinition[] =>
  agents.filter((agent) => {
    if (!agent.promptSourceKey) {
      return true;
    }

    if (promptFileExists(agent.promptSourceKey)) {
      return true;
    }

    console.warn(
      `[RuntimeAgents] Skipping "${agent.id}": prompt file data/prompts/${agent.promptSourceKey}.xml not found`,
    );
    return false;
  });

export const prepareRuntimeAgents = (
  agents: RuntimeAgentDefinition[],
  options: IntegrationAvailabilityOptions = {},
): RuntimeAgentDefinition[] =>
  applyPromptFileAvailability(applyIntegrationAvailability(agents, options));
