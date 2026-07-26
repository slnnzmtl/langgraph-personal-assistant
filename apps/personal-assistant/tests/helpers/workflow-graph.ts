import {
  createAssistant,
  createPolicyRegistry,
  createSystemAgentPolicy,
  deriveCronTargetAgentIds,
  deriveModelKeys,
  DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  mergeCapabilityCatalogs,
  type CompiledSupervisorGraph,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import { loadSupervisorSystemPrompt } from "../../src/agents/load-system-prompt.js";
import type { IFileSender } from "../../src/telegram/file-sender.js";
import { applyLocalModuleAvailability } from "../../src/app/composition/bootstrap-agents.js";
import {
  buildPersonalCapabilityDeps,
  buildPersonalCronGraphHooks,
  buildPersonalSkillCatalog,
} from "../../src/app/composition/personal-pack.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import { createPersonalResolveTools } from "../../src/app/composition/personal-resolve-tools.js";
import { createPersonalCapabilityProviders } from "../../src/runtime-agents/builtin-capabilities.js";
import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
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
  supabaseSession?: SupabaseMcpSession;
  fileSender?: IFileSender;
};

export const createTestWorkflowGraph = ({
  supervisorLlm,
  modelHandlers = {},
  runtimeAgents = buildTestRuntimeAgents(),
  defaultModelKey = "generic",
  messageHistoryMaxTokens = DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  obsidianVaultPath = "/tmp/vault",
  cronJobRepository,
  runtimeAgentRepository,
  supabaseSession,
  fileSender,
}: TestWorkflowGraphOptions): CompiledSupervisorGraph => {
  runtimeAgents = applyLocalModuleAvailability(runtimeAgents, {
    supabaseAvailable: supabaseSession !== undefined,
  });
  const modelKeys = deriveModelKeys(runtimeAgents, defaultModelKey);
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

  const capabilityCatalog = mergeCapabilityCatalogs(createPersonalCapabilityProviders() as never, true);
  const skillCatalog = buildPersonalSkillCatalog(runtimeAgents);
  const resolveTools = createPersonalResolveTools(capabilityCatalog);
  const { loadPromptByKey, policies, shellFormatters } = createAppExecutionKit({
    skillCatalog,
    capabilityCatalog,
  });
  const policyRegistry = createPolicyRegistry([
    ...policies,
    createSystemAgentPolicy({
      capabilityCatalog,
      resolveTools,
      systemAgent: {
        modelKey: "configuration",
      },
      shellFormatters,
    }),
  ]);
  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const resolvedRuntimeAgentRepository =
    runtimeAgentRepository ?? createRuntimeAgentRepositoryFake(runtimeAgents);

  const capabilityDeps = buildPersonalCapabilityDeps(obsidianVaultPath, {
    capabilityCatalog,
    skillCatalog,
    cronTargetAgentIds,
    runtimeAgentRepository: resolvedRuntimeAgentRepository,
    ...(cronJobRepository ? { cronJobRepository } : {}),
    ...(supabaseSession ? { supabaseSession } : {}),
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
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    cronTriggerResolver,
    messageHistoryMaxTokens,
  });
};
