import {
  createAssistant,
  defaultReplyUxConfig,
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
  DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  type CompiledSupervisorGraph,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";
import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "../../src/cron-triggers.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import { loadSupervisorSystemPrompt } from "../../src/agents/load-system-prompt.js";
import type { IFileSender } from "../../src/telegram/file-sender.js";
import { applyLocalModuleAvailability } from "../../src/app/composition/bootstrap-agents.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import {
  createDefaultCapabilityCatalog,
  createCapabilityDeps,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import { FakeLLMConnector } from "./fakes.js";

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

  const capabilityCatalog = createDefaultCapabilityCatalog();
  const skillCatalog = createSkillCatalog({
    approvedModules: deriveSkillModules(runtimeAgents),
  });
  const { loadPromptByKey, policyRegistry } = createAppExecutionKit(deriveExecutors(runtimeAgents), {
    skillCatalog,
    capabilityCatalog,
  });
  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const capabilityDeps = createCapabilityDeps(obsidianVaultPath, {
    capabilityCatalog,
    skillCatalog,
    cronTargetAgentIds,
    ...(cronJobRepository ? { cronJobRepository } : {}),
    ...(runtimeAgentRepository ? { runtimeAgentRepository } : {}),
    ...(supabaseSession ? { supabaseSession } : {}),
    ...(fileSender ? { fileSender } : {}),
  });

  if (!cronJobRepository || !runtimeAgentRepository) {
    throw new Error("createTestWorkflowGraph requires cronJobRepository and runtimeAgentRepository.");
  }

  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return createAssistant({
    supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository,
    capabilityDeps,
    loadPromptByKey,
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    replyUx: defaultReplyUxConfig,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) =>
        cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    messageHistoryMaxTokens,
  });
};
