import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ModelConfig } from "../config.js";
import { GeminiConnector } from "@personal-assistant/llm-gemini";
import { resolveBuiltinModelName } from "./runtime-agent-defaults.js";

export const buildModelRegistry = (
  config: ModelConfig,
  requiredKeys: Iterable<string>,
): Record<string, BaseChatModel> => {
  const models: Record<string, BaseChatModel> = {};

  for (const modelKey of requiredKeys) {
    if (models[modelKey]) {
      continue;
    }

    const connector = new GeminiConnector(config.googleApiKey, resolveBuiltinModelName(config, modelKey));
    models[modelKey] = connector.getModel();
  }

  return models;
};
