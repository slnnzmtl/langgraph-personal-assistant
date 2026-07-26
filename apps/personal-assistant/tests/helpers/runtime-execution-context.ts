import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  createPolicyRegistry,
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  mergeCapabilityCatalogs,
  type RuntimeAgentExecutionContext,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import {
  createDefaultCapabilityCatalog,
  createPersonalCapabilityProviders,
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
  const capabilityCatalog = mergeCapabilityCatalogs(createPersonalCapabilityProviders() as never, true);
  const skillCatalog = createSkillCatalog();
  const { loadPromptByKey, runtimeAgentPolicy } = createAppExecutionKit({
    skillCatalog,
    capabilityCatalog: createDefaultCapabilityCatalog(),
  });
  const policyRegistry = createPolicyRegistry([runtimeAgentPolicy]);
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
    policyRegistry,
  });
};
