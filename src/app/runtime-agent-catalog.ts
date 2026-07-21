import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { resolveAgentModelKey } from "../core/types/agent.js";

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
  new Set(agents.map((agent) => agent.executor ?? "generic"));

export const deriveSkillModules = (agents: RuntimeAgentDefinition[]): string[] =>
  [...new Set(agents.map((agent) => agent.promptSourceKey ?? agent.id))];

export const deriveCronTargetAgentIds = (agents: RuntimeAgentDefinition[]): string[] =>
  agents.filter((agent) => agent.enabled).map((agent) => agent.id);
