import type { CreateRuntimeAgentInput } from "@personal-assistant/supervisor-framework";

export const researcherInput: CreateRuntimeAgentInput = {
  name: "Researcher",
  description: "Answer factual questions with web search.",
  systemPrompt: "You are a concise research assistant. Prefer short answers.",
  capabilityIds: ["web-search"],
  modelKey: "generic",
  maxSteps: 6,
  enabled: true,
};
