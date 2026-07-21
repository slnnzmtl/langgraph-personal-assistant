import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import {
  CONFIGURATOR_AGENT_ID,
  buildDefaultRuntimeAgents,
} from "../app/composition/bootstrap-agents.js";
import { isRuntimeAgentBuiltin } from "../core/types/agent.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";

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
    toolBundleIds: defaultAgent.toolBundleIds,
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
