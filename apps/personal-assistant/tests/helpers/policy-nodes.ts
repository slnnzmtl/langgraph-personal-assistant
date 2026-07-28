import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentNode,
  createRuntimeShellHooks,
  withResolvedAgentSystemPrompt,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type SubAgentState,
  type SubAgentStateUpdate,
  type SubAgentToolSource,
} from "@personal-assistant/supervisor-framework";
import { createDefaultRuntimeShellFormatters } from "../../src/composition/runtime-execution.js";
import { loadSystemPromptByKey } from "../../src/prompts/load.js";
import type { PersonalCapabilityDeps } from "../../src/runtime-agents/capabilities.js";
import {
  buildRuntimeAgentNodeConfigForDefinition,
  resolveCapabilityBehavior,
} from "../../src/policies/runtime-agent-policy.js";
import { createTestSkillCatalog } from "./test-skills-dir.js";

const testSkillCatalog = createTestSkillCatalog();
const testShellFormatters = createDefaultRuntimeShellFormatters(testSkillCatalog);
const testShellHooks = createRuntimeShellHooks(testShellFormatters);

const resolveTestAgentSystemPrompt = (
  definition: Parameters<typeof withResolvedAgentSystemPrompt>[0],
) => withResolvedAgentSystemPrompt(definition, loadSystemPromptByKey);

export type ModelSource = BaseChatModel | { getModel(): BaseChatModel };

const resolveModel = (source: ModelSource): BaseChatModel => {
  if (
    typeof source === "object"
    && source !== null
    && "getModel" in source
    && typeof source.getModel === "function"
  ) {
    return source.getModel();
  }

  return source as BaseChatModel;
};

export const buildNodeConfigForTest = (
  definition: RuntimeAgentDefinition,
  options: { vaultRoot?: string } = {},
): RuntimeAgentNodeConfig => {
  const behavior = resolveCapabilityBehavior(definition, testShellHooks, testShellFormatters);
  const hooks = behavior.createHooks({
    definition,
    capabilityDeps: {
      obsidianVaultPath: options.vaultRoot ?? "/tmp/vault",
    } as PersonalCapabilityDeps,
    shellHooks: testShellHooks,
    shellFormatters: testShellFormatters,
  });

  return {
    ...hooks,
    ...buildRuntimeAgentNodeConfigForDefinition(definition, testShellHooks, testShellFormatters),
  };
};

export const createTestRuntimeAgentNode = (
  model: ModelSource,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  config: RuntimeAgentNodeConfig = buildNodeConfigForTest(definition),
) =>
  createRuntimeAgentNode(
    resolveModel(model),
    resolveTestAgentSystemPrompt(definition),
    tools,
    config,
  ) as (state: SubAgentState) => Promise<SubAgentStateUpdate>;
