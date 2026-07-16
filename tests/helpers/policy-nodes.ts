import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createPromptResolver } from "../../src/core/agents/prompt-resolver.js";
import { loadSystemPromptByKey } from "../../src/prompts/load-system-prompt.js";
import {
  createConfigurationLlmNode,
  createFinanceLlmNode,
  createObsidianLlmNode,
  type ObsidianLlmConnector,
} from "../../src/app/policies/factories.js";
import type { SubAgentToolSource } from "../../src/core/execution/create-sub-agent.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";

const testPromptResolver = createPromptResolver(loadSystemPromptByKey);

export const createFinanceNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => createFinanceLlmNode(testPromptResolver, model, definition, tools);

export const createObsidianNode = (
  llmConnector: ObsidianLlmConnector,
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => createObsidianLlmNode(testPromptResolver, llmConnector, vaultRoot, definition, prebuiltTools);

type ConfigurationNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  definition: RuntimeAgentDefinition;
};

export const createConfigurationNode = (
  model: BaseChatModel,
  tools: SubAgentToolSource,
  options: ConfigurationNodeOptions,
) => createConfigurationLlmNode(testPromptResolver, model, tools, options);
