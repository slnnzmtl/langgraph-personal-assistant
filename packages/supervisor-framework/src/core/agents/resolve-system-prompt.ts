import type { RuntimeAgentDefinition } from "../types/agent.js";

export type LoadPromptByKey = (key: string) => string;

export const resolveAgentSystemPrompt = (
  definition: RuntimeAgentDefinition,
  loadByKey: LoadPromptByKey,
): string => {
  if (definition.promptSourceKey) {
    return loadByKey(definition.promptSourceKey);
  }

  return definition.systemPrompt.trim();
};

export const withResolvedAgentSystemPrompt = (
  definition: RuntimeAgentDefinition,
  loadByKey: LoadPromptByKey,
): RuntimeAgentDefinition => ({
  ...definition,
  systemPrompt: resolveAgentSystemPrompt(definition, loadByKey),
});
