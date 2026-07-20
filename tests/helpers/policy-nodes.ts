import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createPromptResolver } from "../../src/core/agents/prompt-resolver.js";
import { createRuntimeAgentNode } from "../../src/core/execution/runtime-node.js";
import type { SubAgentToolSource } from "../../src/core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../src/core/execution/sub-agent-state.js";
import { loadSystemPromptByKey } from "../../src/prompts/load-system-prompt.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import { createConfigurationNodeHooks } from "../../src/app/policies/configuration-hooks.js";
import { createFinanceNodeHooks } from "../../src/app/policies/finance-hooks.js";
import { createObsidianNodeHooks } from "../../src/app/policies/obsidian-hooks.js";

const testPromptResolver = createPromptResolver(loadSystemPromptByKey);

type ModelSource = BaseChatModel | { getModel(): BaseChatModel };

type ModelConnector = { getModel(): BaseChatModel };

const isModelConnector = (source: ModelSource): source is ModelConnector =>
  typeof (source as ModelConnector).getModel === "function";

const resolveModel = (source: ModelSource): BaseChatModel =>
  isModelConnector(source) ? source.getModel() : source;

const createTestDomainLlmNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  hooks: Parameters<typeof createRuntimeAgentNode>[3],
) =>
  createRuntimeAgentNode(model, definition, tools, hooks) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createFinanceNode = (
  model: ModelSource,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => createTestDomainLlmNode(
  resolveModel(model),
  testPromptResolver.withResolvedSystemPrompt(definition),
  tools,
  createFinanceNodeHooks(),
);

export const createObsidianNode = (
  model: ModelSource,
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => createTestDomainLlmNode(
  resolveModel(model),
  testPromptResolver.withResolvedSystemPrompt(definition),
  prebuiltTools,
  createObsidianNodeHooks(vaultRoot),
);

type ConfigurationNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  definition: RuntimeAgentDefinition;
};

export const createConfigurationNode = (
  model: ModelSource,
  tools: SubAgentToolSource,
  options: ConfigurationNodeOptions,
) => createTestDomainLlmNode(
  resolveModel(model),
  testPromptResolver.withResolvedSystemPrompt(options.definition),
  tools,
  createConfigurationNodeHooks({
    repository: options.repository,
    runtimeCron: options.runtimeCron,
  }),
);
