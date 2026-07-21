import type { AppConfig } from "../../config.js";
import { loadSystemPromptByKey } from "../../prompts/load-system-prompt.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentCapabilityIds } from "../../core/types/agent.js";
import type { RuntimeToolBundleId } from "../../runtime-agents/tool-bundles.js";

export const CONFIGURATOR_AGENT_ID = "configuration" as const;

type AppModelConfigKey = keyof Pick<
  AppConfig,
  "financeModel" | "obsidianModel" | "configurationModel"
>;

export type ConfiguratorSpec = {
  id: typeof CONFIGURATOR_AGENT_ID;
  name: string;
  description: string;
  executor: typeof CONFIGURATOR_AGENT_ID;
  modelKey: typeof CONFIGURATOR_AGENT_ID;
  promptSourceKey: typeof CONFIGURATOR_AGENT_ID;
  toolBundleIds: RuntimeToolBundleId[];
  capabilityIds: RuntimeToolBundleId[];
  maxSteps: number;
  configModelKey: AppModelConfigKey;
};

export const CONFIGURATOR_SPEC: ConfiguratorSpec = {
  id: CONFIGURATOR_AGENT_ID,
  name: "Configuration",
  description: "Manage cron jobs, agent skills, and reusable runtime sub-agents.",
  executor: CONFIGURATOR_AGENT_ID,
  modelKey: CONFIGURATOR_AGENT_ID,
  promptSourceKey: CONFIGURATOR_AGENT_ID,
  toolBundleIds: ["system-config"],
  capabilityIds: ["system-config"],
  maxSteps: 10,
  configModelKey: "configurationModel",
};

/** @deprecated Use CONFIGURATOR_SPEC */
export const BUILTIN_DOMAIN_SPECS = [CONFIGURATOR_SPEC];

/** Core agent ids bootstrapped from code (configurator only). */
export const BUILTIN_DOMAIN_IDS = [CONFIGURATOR_AGENT_ID] as readonly string[];

const buildTimestamp = (): string => new Date().toISOString();

export const buildDefaultRuntimeAgents = (): RuntimeAgentDefinition[] => {
  const timestamp = buildTimestamp();
  const spec = CONFIGURATOR_SPEC;

  return [
    {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      systemPrompt: loadSystemPromptByKey(spec.promptSourceKey),
      promptSourceKey: spec.promptSourceKey,
      toolBundleIds: spec.toolBundleIds,
      capabilityIds: spec.capabilityIds,
      executor: spec.executor,
      modelKey: spec.modelKey,
      builtin: true,
      maxSteps: spec.maxSteps,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

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

export const buildSkillModuleOwnerPattern = (modules: readonly string[]): RegExp => {
  const owners = modules.map((owner) => owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (owners.length === 0) {
    return /(?!)/;
  }

  return new RegExp(`\\b(${owners.join("|")})\\b`);
};

/** @deprecated Use buildSkillModuleOwnerPattern with an explicit module list */
export const buildBuiltinDomainOwnerPattern = buildSkillModuleOwnerPattern;
