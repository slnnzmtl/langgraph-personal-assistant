import { toRuntimeAgentId } from "../../core/types/agent.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import { createSystemAgentDefinition, isSystemAgentId } from "./definition.js";
import { SYSTEM_AGENT_ID } from "./constants.js";
import type { SystemAgentOptions } from "./types.js";

const withoutSystemAgent = (agents: RuntimeAgentDefinition[]): RuntimeAgentDefinition[] =>
  agents.filter((agent) => agent.id !== SYSTEM_AGENT_ID);

const withSystemAgent = (
  persistedAgents: RuntimeAgentDefinition[],
  systemAgent: RuntimeAgentDefinition,
): RuntimeAgentDefinition[] =>
  [...withoutSystemAgent(persistedAgents), systemAgent].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

export type SystemAgentRepository = RuntimeAgentRepository & {
  purgeLegacySystemAgent(): Promise<void>;
};

export const wrapRepositoryWithSystemAgent = (
  repository: RuntimeAgentRepository,
  options: SystemAgentOptions,
): SystemAgentRepository => {
  const buildAgent = () => createSystemAgentDefinition(options);

  return {
    async loadAgents() {
      const persisted = await repository.loadAgents();
      return withSystemAgent(persisted, buildAgent());
    },

    async getAgent(id) {
      if (isSystemAgentId(id)) {
        return buildAgent();
      }

      return repository.getAgent(id);
    },

    async saveAgents(agents) {
      return repository.saveAgents(withoutSystemAgent(agents));
    },

    async createAgent(input) {
      const id = toRuntimeAgentId(input.name);
      if (isSystemAgentId(id)) {
        throw new Error(`Cannot create runtime agent with reserved id: ${SYSTEM_AGENT_ID}`);
      }

      return repository.createAgent(input);
    },

    async updateAgent(id, input) {
      if (isSystemAgentId(id)) {
        throw new Error(`Cannot update built-in runtime agent: ${SYSTEM_AGENT_ID}`);
      }

      return repository.updateAgent(id, input);
    },

    async deleteAgent(id) {
      if (isSystemAgentId(id)) {
        throw new Error(`Cannot delete built-in runtime agent: ${SYSTEM_AGENT_ID}`);
      }

      return repository.deleteAgent(id);
    },

    async purgeLegacySystemAgent() {
      const persisted = await repository.loadAgents();
      const localAgents = withoutSystemAgent(persisted);

      if (localAgents.length !== persisted.length) {
        await repository.saveAgents(localAgents);
      }
    },
  };
};
