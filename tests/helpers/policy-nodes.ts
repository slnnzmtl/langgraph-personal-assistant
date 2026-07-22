import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentNode,
  type RuntimeAgentNodeConfig,
} from "../../src/core/execution/runtime-node.js";
import type { SubAgentToolSource } from "../../src/core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../src/core/execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import { createConfigurationNodeHooks } from "../../src/app/policies/configuration-hooks.js";
import {
  createObsidianNodeHooks,
  selectObsidianToolsForTurn,
} from "../../src/app/policies/obsidian-hooks.js";
import { createDefaultRuntimeShellFormatters } from "../../src/app/register-defaults.js";
import { createRuntimeShellHooks } from "../../src/core/execution/runtime-shell.js";
import { withResolvedAgentSystemPrompt } from "../../src/core/agents/resolve-system-prompt.js";
import { loadSystemPromptByKey } from "../../src/prompts/load-system-prompt.js";
import { createFilesystemSkillCatalog } from "../../src/integrations/skills/filesystem-skill-catalog.js";

const testSkillCatalog = createFilesystemSkillCatalog();
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
    ...createConfigurationNodeHooks({
      repository: options.repository,
      ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
      skillCatalog: testSkillCatalog,
      shellFormatters: testShellFormatters,
    }),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  },
);
