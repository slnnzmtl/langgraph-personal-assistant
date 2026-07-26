import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { resolveAgentCapabilityIds, resolveAgentModelKey } from "../core/types/agent.js";
import { resolveRuntimeAgentPolicyExecutor } from "../core/policies/resolve-runtime-agent-policy.js";

export const deriveModelKeys = (
  agents: RuntimeAgentDefinition[],
  defaultModelKey = "generic",
): Set<string> => {
  const keys = new Set<string>([defaultModelKey]);

  for (const agent of agents) {
    keys.add(resolveAgentModelKey(agent, defaultModelKey));
  }

  return keys;
};

export const deriveExecutors = (agents: RuntimeAgentDefinition[]): Set<string> =>
  new Set(agents.map((agent) => resolveRuntimeAgentPolicyExecutor(agent)));

export const deriveSkillModules = (agents: RuntimeAgentDefinition[]): string[] =>
  [...new Set(agents.map((agent) => agent.promptSourceKey ?? agent.id))];

export const deriveCronTargetAgentIds = (agents: RuntimeAgentDefinition[]): string[] =>
  agents.filter((agent) => agent.enabled).map((agent) => agent.id);

/** Fingerprint of graph wiring inputs: enabled agents, model keys, steps, and capabilities. */
export const deriveRuntimeAgentGraphFingerprint = (agents: RuntimeAgentDefinition[]): string =>
  agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const capabilities = resolveAgentCapabilityIds(agent).slice().sort().join("+");
      const modelKey = resolveAgentModelKey(agent);
      return `${agent.id}:${modelKey}:${agent.maxSteps}:${capabilities}`;
    })
    .sort()
    .join("|");
