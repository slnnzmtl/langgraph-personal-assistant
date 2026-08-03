import {
  createAssistant,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  type CompiledSupervisorGraph,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load.js";
import type { AppConfig } from "../../src/config.js";
import { prepareRuntimeAgents } from "../../src/composition/runtime-agent-defaults.js";
import {
  buildPersonalCapabilityDeps,
  buildPersonalCronGraphHooks,
  buildPersonalSkillCatalog,
} from "../../src/composition/personal-pack.js";
import { buildAppRuntimeExecution } from "../../src/composition/runtime-execution.js";
import { createPersonalRuntimeAgentPolicy } from "../../src/composition/personal-runtime-policy.js";
import type { ILLMConnector } from "@personal-assistant/supervisor-framework";
import type { CronJobRepository } from "@personal-assistant/supervisor-framework";
import type { SqlSession } from "../../src/integrations/mcp/sql-session.js";
import { createPersonalCapabilityCatalog } from "./capability-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import { createRuntimeAgentRepositoryFake, FakeLLMConnector } from "./fakes.js";

export type TestWorkflowGraphOptions = {
  supervisorLlm: ILLMConnector;
  modelHandlers?: Partial<Record<string, (input: unknown) => unknown>>;
  runtimeAgents?: RuntimeAgentDefinition[];
  defaultModelKey?: string;
  messageHistoryMaxTokens?: number;
  obsidianVaultPath?: string;
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  supabaseReadSession?: SqlSession;
  supabaseWriteSession?: SqlSession;
};

export const createTestWorkflowGraph = ({
  supervisorLlm,
  modelHandlers = {},
  runtimeAgents = buildTestRuntimeAgents(),
  defaultModelKey = "generic" as const,
  messageHistoryMaxTokens = DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  obsidianVaultPath = "/tmp/vault",
  cronJobRepository,
  runtimeAgentRepository,
  supabaseReadSession,
  supabaseWriteSession,
}: TestWorkflowGraphOptions): CompiledSupervisorGraph => {
  runtimeAgents = prepareRuntimeAgents(runtimeAgents, {
    supabaseAvailable: supabaseReadSession !== undefined || supabaseWriteSession !== undefined,
  });
  const modelKeys = deriveModelKeys(runtimeAgents, defaultModelKey as "generic");
  const sharedRuntimeModel = supervisorLlm instanceof FakeLLMConnector
    ? supervisorLlm.getSharedRuntimeModel()
    : supervisorLlm.getModel();
  const models = Object.fromEntries(
    [...modelKeys].map((modelKey) => [
      modelKey,
      modelHandlers[modelKey]
        ? new FakeLLMConnector(modelHandlers[modelKey]!).getModel()
        : sharedRuntimeModel,
    ]),
  );

  const adapters = {
    ...(supabaseReadSession ? { supabaseReadSession } : {}),
    ...(supabaseWriteSession ? { supabaseWriteSession } : {}),
  };
  const capabilityCatalog = createPersonalCapabilityCatalog({
    config: { obsidianVaultPath } as AppConfig,
    adapters,
  });
  const skillCatalog = buildPersonalSkillCatalog(runtimeAgents);
  const { loadPromptByKey, runtimeAgentPolicy } = buildAppRuntimeExecution({
    skillCatalog,
    capabilityCatalog,
    createRuntimeAgentPolicy: (shellHooks, policyOptions) =>
      createPersonalRuntimeAgentPolicy(
        shellHooks,
        policyOptions,
        obsidianVaultPath || undefined,
      ),
  });
  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const resolvedRuntimeAgentRepository =
    runtimeAgentRepository ?? createRuntimeAgentRepositoryFake(runtimeAgents);

  const capabilityDeps = buildPersonalCapabilityDeps({
    capabilityCatalog,
    skillCatalog,
    cronTargetAgentIds,
    runtimeAgentRepository: resolvedRuntimeAgentRepository,
    ...(cronJobRepository ? { cronJobRepository } : {}),
  });

  const { cronTriggerResolver } = buildPersonalCronGraphHooks(cronTargetAgentIds);

  return createAssistant({
    supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository: resolvedRuntimeAgentRepository,
    capabilityDeps,
    loadPromptByKey,
    runtimeAgentPolicy,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    cronTriggerResolver,
    messageHistoryMaxTokens,
  });
};
