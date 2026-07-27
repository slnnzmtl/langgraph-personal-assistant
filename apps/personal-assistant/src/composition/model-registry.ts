import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AppConfig } from "../config.js";
import { GeminiConnector } from "../models/gemini-connector.js";
import { resolveBuiltinModelName } from "./bootstrap-agents.js";

export const buildModelRegistry = (
  config: AppConfig,
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
