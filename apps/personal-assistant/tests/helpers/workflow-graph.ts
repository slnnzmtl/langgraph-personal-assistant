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
import type { IFileSender } from "../../src/ports/file-sender.js";
import { prepareRuntimeAgents } from "../../src/composition/runtime-agent-defaults.js";
import {
  buildPersonalCapabilityDeps,
  buildPersonalCronGraphHooks,
  buildPersonalSkillCatalog,
} from "../../src/composition/personal-pack.js";
import { buildAppRuntimeExecution } from "../../src/composition/runtime-execution.js";
import type { ILLMConnector } from "@personal-assistant/supervisor-framework";
import type { CronJobRepository } from "@personal-assistant/supervisor-framework";
import type { SqlSession } from "../../src/ports/sql-session.js";
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
  fileSender?: IFileSender;
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
  fileSender,
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

  const capabilityCatalog = createPersonalCapabilityCatalog();
  const skillCatalog = buildPersonalSkillCatalog(runtimeAgents);
  const { loadPromptByKey, runtimeAgentPolicy } = buildAppRuntimeExecution({
    skillCatalog,
    capabilityCatalog,
  });
  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const resolvedRuntimeAgentRepository =
    runtimeAgentRepository ?? createRuntimeAgentRepositoryFake(runtimeAgents);

  const capabilityDeps = buildPersonalCapabilityDeps(obsidianVaultPath, {
    capabilityCatalog,
    skillCatalog,
    cronTargetAgentIds,
    runtimeAgentRepository: resolvedRuntimeAgentRepository,
    ...(cronJobRepository ? { cronJobRepository } : {}),
    ...(supabaseReadSession ? { supabaseReadSession } : {}),
    ...(supabaseWriteSession ? { supabaseWriteSession } : {}),
    ...(fileSender ? { fileSender } : {}),
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
