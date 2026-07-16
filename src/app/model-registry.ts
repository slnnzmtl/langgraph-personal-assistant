import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AppConfig } from "../config.js";
import { GeminiConnector } from "../connectors/llm-connector.js";

const MODEL_ENV_RESOLVERS: Record<string, (config: AppConfig) => string> = {
  generic: (config) => config.obsidianModel,
  finance: (config) => config.financeModel,
  obsidian: (config) => config.obsidianModel,
  configuration: (config) => config.configurationModel,
};

export const resolveModelNameForKey = (config: AppConfig, modelKey: string): string =>
  MODEL_ENV_RESOLVERS[modelKey]?.(config) ?? config.geminiModel;

export const buildModelRegistry = (
  config: AppConfig,
  requiredKeys: Iterable<string>,
): Record<string, BaseChatModel> => {
  const models: Record<string, BaseChatModel> = {};

  for (const modelKey of requiredKeys) {
    if (models[modelKey]) {
      continue;
    }

    const connector = new GeminiConnector(config.googleApiKey, resolveModelNameForKey(config, modelKey));
    models[modelKey] = connector.getModel();
  }

  return models;
};
