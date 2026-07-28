import type {
  CreateRuntimeAgentInput,
  RuntimeAgentDefinition,
  RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";

export const researcherInput: CreateRuntimeAgentInput = {
  name: "Researcher",
  description: "Answer factual questions with web search.",
  systemPrompt: "You are a concise research assistant. Prefer short answers.",
  capabilityIds: ["web-search"],
  modelKey: "generic",
  maxSteps: 6,
  enabled: true,
};

export const researcher: RuntimeAgentDefinition = {
  id: "researcher",
  name: researcherInput.name,
  description: researcherInput.description,
  systemPrompt: researcherInput.systemPrompt,
  capabilityIds: researcherInput.capabilityIds,
  modelKey: researcherInput.modelKey,
  maxSteps: researcherInput.maxSteps ?? 6,
  enabled: researcherInput.enabled ?? true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const seedAgents = async (
  repository: RuntimeAgentRepository,
  _context: { adapters: Record<string, never> },
): Promise<RuntimeAgentDefinition[]> => {
  const existing = await repository.loadAgents();
  if (existing.some((agent) => agent.id === researcher.id)) {
    return existing;
  }

  await repository.createAgent(researcherInput);
  return repository.loadAgents();
};
