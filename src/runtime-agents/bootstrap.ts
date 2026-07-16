import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import { applyBuiltinDomainAvailability, buildDefaultRuntimeAgents } from "./builtin-domains.js";
import { isRuntimeAgentBuiltin } from "../core/types/agent.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";

export type RuntimeAgentBootstrapOptions = {
  financeAvailable?: boolean;
};

export const mergeRuntimeAgents = (
  defaultAgents: RuntimeAgentDefinition[],
  persistedAgents: RuntimeAgentDefinition[],
): RuntimeAgentDefinition[] => {
  const merged = new Map<string, RuntimeAgentDefinition>();

  for (const agent of defaultAgents) {
    merged.set(agent.id, agent);
  }

  for (const agent of persistedAgents) {
    const defaultAgent = merged.get(agent.id);

    if (defaultAgent && isRuntimeAgentBuiltin(defaultAgent)) {
      merged.set(agent.id, {
        ...defaultAgent,
        description: agent.description,
        maxSteps: agent.maxSteps,
        enabled: agent.enabled,
        updatedAt: agent.updatedAt,
        modelKey: defaultAgent.modelKey,
        promptSourceKey: defaultAgent.promptSourceKey ?? defaultAgent.id,
        executor: defaultAgent.executor,
        toolBundleIds: defaultAgent.toolBundleIds,
        skillAttachments: defaultAgent.skillAttachments,
      });
      continue;
    }

    merged.set(agent.id, agent);
  }

  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
};

export const ensureBuiltinRuntimeAgents = async (
  repository: RuntimeAgentRepository,
  options?: RuntimeAgentBootstrapOptions,
): Promise<RuntimeAgentDefinition[]> => {
  const defaultAgents = buildDefaultRuntimeAgents().map((agent) =>
    applyBuiltinDomainAvailability(agent, options),
  );

  const persistedAgents = await repository.loadAgents();
  const mergedAgents = mergeRuntimeAgents(defaultAgents, persistedAgents);
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
