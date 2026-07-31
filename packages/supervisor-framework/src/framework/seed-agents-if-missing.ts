import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import type { CreateRuntimeAgentInput, RuntimeAgentDefinition } from "../core/types/agent.js";
import { toRuntimeAgentId } from "../core/types/agent.js";

export const seedAgentsIfMissing = (
  inputs: CreateRuntimeAgentInput[],
): ((
  repository: RuntimeAgentRepository,
  context: { adapters: Record<string, unknown> },
) => Promise<RuntimeAgentDefinition[]>) =>
  async (repository) => {
    const existing = await repository.loadAgents();
    const existingIds = new Set(existing.map((agent) => agent.id));

    for (const input of inputs) {
      const id = toRuntimeAgentId(input.name);
      if (!existingIds.has(id)) {
        await repository.createAgent(input);
        existingIds.add(id);
      }
    }

    return repository.loadAgents();
  };
