import type { AppConfig } from "../../config.js";
import { loadSystemPromptByKey } from "../../agents/load-system-prompt.js";
import {
  resolveAgentCapabilityIds,
  toRuntimeAgentId,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import type { BuiltinCapabilityId } from "../../runtime-agents/builtin-capabilities.js";

export const CONFIGURATOR_AGENT_ID = "configuration" as const;

const CONFIGURATOR_AGENT_EPOCH = "1970-01-01T00:00:00.000Z";

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

export const buildConfiguratorAgent = (): RuntimeAgentDefinition => {
  const spec = CONFIGURATOR_SPEC;

  return {
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
    createdAt: CONFIGURATOR_AGENT_EPOCH,
    updatedAt: CONFIGURATOR_AGENT_EPOCH,
  };
};

export const buildDefaultRuntimeAgents = (): RuntimeAgentDefinition[] => [buildConfiguratorAgent()];

export const isConfiguratorAgentId = (id: string): id is typeof CONFIGURATOR_AGENT_ID =>
  id === CONFIGURATOR_AGENT_ID;

export const stripConfiguratorFromAgents = (
  agents: RuntimeAgentDefinition[],
): RuntimeAgentDefinition[] => agents.filter((agent) => agent.id !== CONFIGURATOR_AGENT_ID);

export const withConfiguratorAgent = (
  persistedAgents: RuntimeAgentDefinition[],
  configurator: RuntimeAgentDefinition = buildConfiguratorAgent(),
): RuntimeAgentDefinition[] =>
  [...stripConfiguratorFromAgents(persistedAgents), configurator].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

export type ConfiguratorAwareRuntimeAgentRepository = RuntimeAgentRepository & {
  purgeLegacyConfigurator(): Promise<void>;
};

export const createConfiguratorAwareRuntimeAgentRepository = (
  repository: RuntimeAgentRepository,
): ConfiguratorAwareRuntimeAgentRepository => ({
  async loadAgents() {
    const persisted = await repository.loadAgents();
    return withConfiguratorAgent(stripConfiguratorFromAgents(persisted));
  },

  async getAgent(id) {
    if (isConfiguratorAgentId(id)) {
      return buildConfiguratorAgent();
    }

    return repository.getAgent(id);
  },

  async saveAgents(agents) {
    return repository.saveAgents(stripConfiguratorFromAgents(agents));
  },

  async createAgent(input) {
    const id = toRuntimeAgentId(input.name);
    if (isConfiguratorAgentId(id)) {
      throw new Error(`Cannot create runtime agent with reserved id: ${CONFIGURATOR_AGENT_ID}`);
    }

    return repository.createAgent(input);
  },

  async updateAgent(id, input) {
    if (isConfiguratorAgentId(id)) {
      throw new Error(`Cannot update built-in runtime agent: ${CONFIGURATOR_AGENT_ID}`);
    }

    return repository.updateAgent(id, input);
  },

  async deleteAgent(id) {
    if (isConfiguratorAgentId(id)) {
      throw new Error(`Cannot delete built-in runtime agent: ${CONFIGURATOR_AGENT_ID}`);
    }

    return repository.deleteAgent(id);
  },

  async purgeLegacyConfigurator() {
    const persisted = await repository.loadAgents();
    const localAgents = stripConfiguratorFromAgents(persisted);

    if (localAgents.length !== persisted.length) {
      await repository.saveAgents(localAgents);
    }
  },
});

/** @deprecated Use createConfiguratorAwareRuntimeAgentRepository */
export const wrapRuntimeAgentRepositoryWithConfigurator = createConfiguratorAwareRuntimeAgentRepository;

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
