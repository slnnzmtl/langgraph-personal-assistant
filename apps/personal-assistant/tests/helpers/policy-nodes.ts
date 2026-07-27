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
import { loadSystemPromptByKey } from "../../src/load-system-prompt.js";
import type { CapabilityDeps } from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "@personal-assistant/supervisor-framework";
import {
  buildRuntimeAgentNodeConfigForDefinition,
  resolveCapabilityBehavior,
} from "../../src/policies/runtime-agent-policy.js";

const testSkillCatalog = createSkillCatalog();
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
    } as CapabilityDeps,
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

/** @deprecated Use buildNodeConfigForTest(definition) */
export const financeRuntimeNodeConfig = (): RuntimeAgentNodeConfig =>
  buildNodeConfigForTest({
    id: "finance",
    name: "Finance",
    description: "",
    systemPrompt: "",
    capabilityIds: ["finance-domain"],
    maxSteps: 8,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

/** @deprecated Use buildNodeConfigForTest(definition, { vaultRoot }) */
export const obsidianRuntimeNodeConfig = (vaultRoot: string): RuntimeAgentNodeConfig =>
  buildNodeConfigForTest({
    id: "obsidian",
    name: "Obsidian",
    description: "",
    systemPrompt: "",
    capabilityIds: ["obsidian-vault"],
    maxSteps: 8,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }, { vaultRoot });

/** @deprecated Use buildNodeConfigForTest(definition) */
export const configurationRuntimeNodeConfig = (): RuntimeAgentNodeConfig =>
  buildNodeConfigForTest({
    id: "configuration",
    name: "Configuration",
    description: "",
    systemPrompt: "",
    capabilityIds: ["system-config"],
    modelKey: "configuration",
    maxSteps: 10,
    enabled: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
