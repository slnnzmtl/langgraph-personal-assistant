import type { RuntimeAgentRepository } from "../agents/repository.js";
import type {
  CreateRuntimeAgentInput,
  UpdateRuntimeAgentInput,
} from "../types/agent.js";

export const DATA_WRITES_DISABLED_MESSAGE = "Data writes are disabled in this process";

const rejectWrite = (): never => {
  throw new Error(DATA_WRITES_DISABLED_MESSAGE);
};

export const createReadOnlyRuntimeAgentRepository = (
  repository: RuntimeAgentRepository,
): RuntimeAgentRepository => ({
  loadAgents: () => repository.loadAgents(),
  getAgent: (id) => repository.getAgent(id),
  saveAgents: async () => rejectWrite(),
  createAgent: async (_input: CreateRuntimeAgentInput) => rejectWrite(),
  updateAgent: async (_id: string, _input: UpdateRuntimeAgentInput) => rejectWrite(),
  deleteAgent: async (_id: string) => rejectWrite(),
  ...(repository.describePromptLocation
    ? { describePromptLocation: (id: string) => repository.describePromptLocation!(id) }
    : {}),
});
