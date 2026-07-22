import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
  type RuntimeAgentExecutionContext,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import { createDefaultCapabilityCatalog, type CapabilityDeps } from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "../../src/prompts/skill-catalog.js";
import { createRuntimeAgentRepositoryFake } from "./fakes.js";

export type CreateAppRuntimeExecutionContextInput = {
  defaultModel: BaseChatModel;
  repository?: RuntimeAgentRepository;
  capabilityDeps: CapabilityDeps;
  executors?: Iterable<string>;
};

export const createAppRuntimeExecutionContext = (
  input: CreateAppRuntimeExecutionContextInput,
): RuntimeAgentExecutionContext<CapabilityDeps> => {
  const runtimeAgents = buildTestRuntimeAgents();
  const defaultModelKey = "generic";
  const executors = input.executors ?? deriveExecutors(runtimeAgents);
  const { loadPromptByKey, policyRegistry } = createAppExecutionKit(executors, {
    skillCatalog: createSkillCatalog(),
    capabilityCatalog: createDefaultCapabilityCatalog(),
  });
  const cronTargetAgentIds = input.capabilityDeps.cronTargetAgentIds
    ?? deriveCronTargetAgentIds(runtimeAgents);

  return createCoreExecutionContext<CapabilityDeps>({
    models: Object.fromEntries(
      [...deriveModelKeys(runtimeAgents, defaultModelKey)].map((modelKey) => [
        modelKey,
        input.defaultModel,
      ]),
    ),
    defaultModelKey,
    repository: input.repository ?? createRuntimeAgentRepositoryFake(),
    capabilityDeps: {
      ...input.capabilityDeps,
      cronTargetAgentIds,
    },
    loadPromptByKey,
    policyRegistry,
  });
};
