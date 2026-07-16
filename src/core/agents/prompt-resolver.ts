import type { RuntimeAgentDefinition } from "../types/agent.js";

export type PromptResolver = {
  resolveSystemPrompt(definition: RuntimeAgentDefinition): string;
  withResolvedSystemPrompt(definition: RuntimeAgentDefinition): RuntimeAgentDefinition;
};

export const createPromptResolver = (
  loadByKey: (key: string) => string,
): PromptResolver => {
  const resolveSystemPrompt = (definition: RuntimeAgentDefinition): string => {
    if (definition.promptSourceKey) {
      return loadByKey(definition.promptSourceKey);
    }

    return definition.systemPrompt.trim();
  };

  const withResolvedSystemPrompt = (
    definition: RuntimeAgentDefinition,
  ): RuntimeAgentDefinition => ({
    ...definition,
    systemPrompt: resolveSystemPrompt(definition),
  });

  return { resolveSystemPrompt, withResolvedSystemPrompt };
};
