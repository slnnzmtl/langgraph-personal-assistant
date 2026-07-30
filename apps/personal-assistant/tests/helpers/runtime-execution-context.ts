import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  type RuntimeAgentExecutionContext,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { buildAppRuntimeExecution } from "../../src/composition/runtime-execution.js";
import { createPersonalRuntimeAgentPolicy } from "../../src/composition/personal-runtime-policy.js";
import { createPersonalCapabilityCatalog } from "./capability-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import {
  type PersonalCapabilityDeps,
} from "../../src/runtime-agents/system-capability-deps.js";
import { createRuntimeAgentRepositoryFake } from "./fakes.js";
import { createTestSkillCatalog } from "./test-skills-dir.js";

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
  const skillCatalog = createTestSkillCatalog();
  const { loadPromptByKey, runtimeAgentPolicy } = buildAppRuntimeExecution({
    skillCatalog,
    capabilityCatalog,
    createRuntimeAgentPolicy: (shellHooks, policyOptions) =>
      createPersonalRuntimeAgentPolicy(shellHooks, policyOptions, "/tmp/vault"),
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
