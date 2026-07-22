import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createWorkflowGraph } from "../../src/agent.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import type { IFileSender } from "../../src/telegram/file-sender.js";
import {
  applyLocalModuleAvailability,
} from "../../src/app/composition/bootstrap-agents.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
} from "../../src/app/composition/create-supervisor-system.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "../../src/core/message-trimming.js";
import {
  createDefaultCapabilityCatalog,
  createCapabilityDeps,
} from "../../src/runtime-agents/builtin-capabilities.js";
import { createFilesystemSkillCatalog } from "../../src/integrations/skills/filesystem-skill-catalog.js";
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
}: TestWorkflowGraphOptions) => {
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

  const skillCatalog = createFilesystemSkillCatalog({
    approvedModules: deriveSkillModules(runtimeAgents),
  });
  const { loadPromptByKey, policyRegistry } = createAppExecutionKit(deriveExecutors(runtimeAgents), {
    skillCatalog,
  });
  const capabilityDeps = createCapabilityDeps(obsidianVaultPath, {
    capabilityCatalog: createDefaultCapabilityCatalog(),
    skillCatalog,
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    ...(cronJobRepository ? { cronJobRepository } : {}),
    ...(runtimeAgentRepository ? { runtimeAgentRepository } : {}),
    ...(supabaseSession ? { supabaseSession } : {}),
    ...(fileSender ? { fileSender } : {}),
  });

  if (!cronJobRepository || !runtimeAgentRepository) {
    throw new Error("createTestWorkflowGraph requires cronJobRepository and runtimeAgentRepository.");
  }

  return createWorkflowGraph({
    supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    messageHistoryMaxTokens,
    runtimeAgentRepository,
    loadPromptByKey,
    policyRegistry,
    bundleDeps: capabilityDeps,
  });
};
