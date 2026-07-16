import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createPromptResolver } from "../../src/core/agents/prompt-resolver.js";
import { loadSystemPromptByKey } from "../../src/prompts/load-system-prompt.js";
import {
  createConfigurationLlmNode,
  createFinanceLlmNode,
  createObsidianLlmNode,
} from "../../src/app/policies/factories.js";
import type { SubAgentToolSource } from "../../src/core/execution/runtime-node.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";

const testPromptResolver = createPromptResolver(loadSystemPromptByKey);

type ModelSource = BaseChatModel | { getModel(): BaseChatModel };

type ModelConnector = { getModel(): BaseChatModel };

const isModelConnector = (source: ModelSource): source is ModelConnector =>
  typeof (source as ModelConnector).getModel === "function";

const resolveModel = (source: ModelSource): BaseChatModel =>
  isModelConnector(source) ? source.getModel() : source;

export const createFinanceNode = (
  model: ModelSource,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => createFinanceLlmNode(testPromptResolver, resolveModel(model), definition, tools);

export const createObsidianNode = (
  model: ModelSource,
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => createObsidianLlmNode(testPromptResolver, resolveModel(model), vaultRoot, definition, prebuiltTools);

type ConfigurationNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  definition: RuntimeAgentDefinition;
};

export const createConfigurationNode = (
  model: ModelSource,
  tools: SubAgentToolSource,
  options: ConfigurationNodeOptions,
) => createConfigurationLlmNode(testPromptResolver, resolveModel(model), tools, options);
