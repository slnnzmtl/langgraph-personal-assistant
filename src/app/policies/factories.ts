import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { PromptResolver } from "../../core/agents/prompt-resolver.js";
import { createRuntimeAgentNode } from "../../core/execution/runtime-node.js";
import type { SubAgentToolSource } from "../../core/execution/create-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../core/execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { createFinanceNodeHooks } from "./finance-hooks.js";
import { createObsidianNodeHooks } from "./obsidian-hooks.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";

export const createFinanceLlmNode = (
  promptResolver: PromptResolver,
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => {
  const resolvedDefinition = promptResolver.withResolvedSystemPrompt(definition);
  return createRuntimeAgentNode(
    model,
    resolvedDefinition,
    tools,
    createFinanceNodeHooks(),
  ) as (state: SubAgentState) => Promise<SubAgentStateUpdate>;
};

export const createObsidianLlmNode = (
  promptResolver: PromptResolver,
  model: BaseChatModel,
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => {
  const resolvedDefinition = promptResolver.withResolvedSystemPrompt(definition);
  return createRuntimeAgentNode(
    model,
    resolvedDefinition,
    prebuiltTools,
    createObsidianNodeHooks(vaultRoot),
  ) as (state: SubAgentState) => Promise<SubAgentStateUpdate>;
};

type ConfigurationLlmNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService | undefined;
  definition: RuntimeAgentDefinition;
};

export const createConfigurationLlmNode = (
  promptResolver: PromptResolver,
  model: BaseChatModel,
  tools: SubAgentToolSource,
  options: ConfigurationLlmNodeOptions,
) => {
  const resolvedDefinition = promptResolver.withResolvedSystemPrompt(options.definition);
  return createRuntimeAgentNode(
    model,
    resolvedDefinition,
    tools,
    createConfigurationNodeHooks({
      repository: options.repository,
      runtimeCron: options.runtimeCron,
    }),
  ) as (state: SubAgentState) => Promise<SubAgentStateUpdate>;
};
