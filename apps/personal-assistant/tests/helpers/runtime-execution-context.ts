import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  type RuntimeAgentExecutionContext,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { buildAppRuntimeExecution } from "../../src/app/composition/runtime-execution.js";
import { createPersonalCapabilityCatalog } from "./capability-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import {
  type CapabilityDeps,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";
import { createRuntimeAgentRepositoryFake } from "./fakes.js";

export type CreateAppRuntimeExecutionContextInput = {
  defaultModel: BaseChatModel;
  repository?: RuntimeAgentRepository;
  capabilityDeps: CapabilityDeps;
};

export const createAppRuntimeExecutionContext = (
  input: CreateAppRuntimeExecutionContextInput,
): RuntimeAgentExecutionContext<CapabilityDeps> => {
  const runtimeAgents = buildTestRuntimeAgents();
  const defaultModelKey = "generic";
  const capabilityCatalog = createPersonalCapabilityCatalog();
  const skillCatalog = createSkillCatalog();
  const { loadPromptByKey, runtimeAgentPolicy } = buildAppRuntimeExecution({
    skillCatalog,
    capabilityCatalog,
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
      capabilityCatalog,
    },
    loadPromptByKey,
    runtimeAgentPolicy,
  });
};
