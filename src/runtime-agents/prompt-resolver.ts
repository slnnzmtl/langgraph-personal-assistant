import {
  loadConfigurationSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
} from "../prompts/load-system-prompt.js";
import type { BuiltinRuntimeAgentId, RuntimeAgentDefinition } from "./types.js";

const PROMPT_LOADERS: Record<BuiltinRuntimeAgentId, () => string> = {
  finance: loadFinanceSystemPrompt,
  obsidian: loadObsidianSystemPrompt,
  configuration: loadConfigurationSystemPrompt,
};

export const resolveBuiltinPromptSource = (agentId: BuiltinRuntimeAgentId): string =>
  PROMPT_LOADERS[agentId]();

export const resolveRuntimeAgentSystemPrompt = (definition: RuntimeAgentDefinition): string => {
  if (definition.promptSourceKey) {
    return resolveBuiltinPromptSource(definition.promptSourceKey);
  }

  return definition.systemPrompt.trim();
};

export const withResolvedSystemPrompt = (
  definition: RuntimeAgentDefinition,
): RuntimeAgentDefinition => ({
  ...definition,
  systemPrompt: resolveRuntimeAgentSystemPrompt(definition),
});
