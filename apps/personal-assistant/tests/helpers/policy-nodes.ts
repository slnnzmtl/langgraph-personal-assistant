import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentNode,
  createRuntimeShellHooks,
  createSystemAgentNodeHooks,
  withResolvedAgentSystemPrompt,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type SubAgentState,
  type SubAgentStateUpdate,
  type SubAgentToolSource,
} from "@personal-assistant/supervisor-framework";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import {
  createObsidianNodeHooks,
  selectObsidianToolsForTurn,
} from "../../src/app/policies/obsidian-hooks.js";
import { createDefaultRuntimeShellFormatters } from "../../src/app/register-defaults.js";
import { loadSystemPromptByKey } from "../../src/agents/load-system-prompt.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";

const testSkillCatalog = createSkillCatalog();
const testShellFormatters = createDefaultRuntimeShellFormatters(testSkillCatalog);

const resolveTestAgentSystemPrompt = (
  definition: Parameters<typeof withResolvedAgentSystemPrompt>[0],
) => withResolvedAgentSystemPrompt(definition, loadSystemPromptByKey);

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
  config: RuntimeAgentNodeConfig,
) =>
  createRuntimeAgentNode(model, definition, tools, config) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createFinanceNode = (
  model: ModelSource,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => createTestDomainLlmNode(
  resolveModel(model),
  resolveTestAgentSystemPrompt(definition),
  tools,
  {
    ...createRuntimeShellHooks(testShellFormatters),
    logLabel: "finance-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to complete finance request: ${error instanceof Error ? error.message : "Unknown error during finance request"}`,
  },
);

export const createObsidianNode = (
  model: ModelSource,
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => createTestDomainLlmNode(
  resolveModel(model),
  resolveTestAgentSystemPrompt(definition),
  prebuiltTools,
  {
    ...createObsidianNodeHooks(vaultRoot, testShellFormatters),
    logLabel: "obsidian-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
    selectToolsForTurn: selectObsidianToolsForTurn,
  },
);

type ConfigurationNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  definition: RuntimeAgentDefinition;
  onCronMutated?: () => Promise<void>;
};

export const createConfigurationNode = (
  model: ModelSource,
  tools: SubAgentToolSource,
  options: ConfigurationNodeOptions,
) => createTestDomainLlmNode(
  resolveModel(model),
  resolveTestAgentSystemPrompt(options.definition),
  tools,
  {
    ...createSystemAgentNodeHooks({
      ...(options.onCronMutated ? { onCronMutated: options.onCronMutated } : {}),
      shellFormatters: testShellFormatters,
    }),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  },
);
