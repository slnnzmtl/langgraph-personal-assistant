import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  type RuntimeAgentExecutionContext,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { buildAppRuntimeExecution } from "../../src/composition/runtime-execution.js";
import { createPersonalCapabilityCatalog } from "./capability-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import {
  type PersonalCapabilityDeps,
} from "../../src/runtime-agents/capabilities.js";
import { createSkillCatalog } from "@personal-assistant/supervisor-framework";
import { createRuntimeAgentRepositoryFake } from "./fakes.js";

export type CreateAppRuntimeExecutionContextInput = {
  defaultModel: BaseChatModel;
  repository?: RuntimeAgentRepository;
  capabilityDeps: PersonalCapabilityDeps;
};

export const createAppRuntimeExecutionContext = (
  input: CreateAppRuntimeExecutionContextInput,
): RuntimeAgentExecutionContext<PersonalCapabilityDeps> => {
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

  return createCoreExecutionContext<PersonalCapabilityDeps>({
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
