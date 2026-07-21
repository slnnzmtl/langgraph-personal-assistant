import { withResolvedAgentSystemPrompt } from "../../src/core/agents/resolve-system-prompt.js";
import { loadSystemPromptByKey } from "../../src/prompts/load-system-prompt.js";

export const resolveTestAgentSystemPrompt = (definition: Parameters<typeof withResolvedAgentSystemPrompt>[0]) =>
  withResolvedAgentSystemPrompt(definition, loadSystemPromptByKey);
