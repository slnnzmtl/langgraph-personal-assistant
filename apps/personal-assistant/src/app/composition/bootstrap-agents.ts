import type { AppConfig } from "../../config.js";
import { loadSystemPromptByKey } from "../../prompts/load-system-prompt.js";
import {
  isRuntimeAgentBuiltin,
  resolveAgentCapabilityIds,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import type { BuiltinCapabilityId } from "../../runtime-agents/builtin-capabilities.js";

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
  capabilityIds: BuiltinCapabilityId[];
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
  capabilityIds: ["system-config"],
  maxSteps: 10,
  configModelKey: "configurationModel",
};

/** Core agent ids bootstrapped from code (configurator only). */
export const BUILTIN_AGENT_IDS = [CONFIGURATOR_AGENT_ID] as readonly string[];

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

const mergeConfiguratorAgent = (
  defaultAgent: RuntimeAgentDefinition,
  persistedAgents: RuntimeAgentDefinition[],
): RuntimeAgentDefinition => {
  const persisted = persistedAgents.find((agent) => agent.id === CONFIGURATOR_AGENT_ID);

  if (!persisted || !isRuntimeAgentBuiltin(defaultAgent)) {
    return defaultAgent;
  }

  return {
    ...defaultAgent,
    description: persisted.description,
    maxSteps: Math.max(defaultAgent.maxSteps, persisted.maxSteps),
    enabled: persisted.enabled,
    updatedAt: persisted.updatedAt,
    modelKey: defaultAgent.modelKey,
    promptSourceKey: defaultAgent.promptSourceKey ?? defaultAgent.id,
    executor: defaultAgent.executor,
    capabilityIds: defaultAgent.capabilityIds,
  };
};

export const ensureBuiltinRuntimeAgents = async (
  repository: RuntimeAgentRepository,
): Promise<RuntimeAgentDefinition[]> => {
  const configurator = buildDefaultRuntimeAgents()[0]!;
  const persistedAgents = await repository.loadAgents();
  const localAgents = persistedAgents.filter((agent) => agent.id !== CONFIGURATOR_AGENT_ID);
  const mergedConfigurator = mergeConfiguratorAgent(configurator, persistedAgents);
  const mergedAgents = [...localAgents, mergedConfigurator].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const persistedById = new Map(persistedAgents.map((agent) => [agent.id, agent]));
  const changed = mergedAgents.length !== persistedAgents.length
    || mergedAgents.some((agent) => {
      const persisted = persistedById.get(agent.id);
      return !persisted || JSON.stringify(persisted) !== JSON.stringify(agent);
    });

  if (changed) {
    await repository.saveAgents(mergedAgents);
  }

  return mergedAgents;
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
