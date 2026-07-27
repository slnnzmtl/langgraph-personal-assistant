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

export type ModelSource = BaseChatModel | { getModel(): BaseChatModel };

const resolveModel = (source: ModelSource): BaseChatModel =>
  typeof (source as { getModel?: () => BaseChatModel }).getModel === "function"
    ? (source as { getModel: () => BaseChatModel }).getModel()
    : source;

export const createTestRuntimeAgentNode = (
  model: ModelSource,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  config: RuntimeAgentNodeConfig,
) =>
  createRuntimeAgentNode(
    resolveModel(model),
    resolveTestAgentSystemPrompt(definition),
    tools,
    config,
  ) as (state: SubAgentState) => Promise<SubAgentStateUpdate>;

export const financeRuntimeNodeConfig = (): RuntimeAgentNodeConfig => ({
  ...createRuntimeShellHooks(testShellFormatters),
  logLabel: "finance-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to complete finance request: ${error instanceof Error ? error.message : "Unknown error during finance request"}`,
});

export const obsidianRuntimeNodeConfig = (vaultRoot: string): RuntimeAgentNodeConfig => ({
  ...createObsidianNodeHooks(vaultRoot, testShellFormatters),
  logLabel: "obsidian-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
  selectToolsForTurn: selectObsidianToolsForTurn,
});

export const configurationRuntimeNodeConfig = (): RuntimeAgentNodeConfig => ({
  ...createSystemAgentNodeHooks(testShellFormatters),
  logLabel: "configuration-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
});
