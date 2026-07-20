import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "../../src/agent.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/runtime-agent-catalog.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "../../src/core/message-trimming.js";
import {
  createDefaultCapabilityCatalog,
  createRuntimeToolBundleDeps,
} from "../../src/runtime-agents/tool-bundles.js";
import { createFilesystemSkillCatalog } from "../../src/integrations/skills/filesystem-skill-catalog.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import { FakeLLMConnector } from "./fakes.js";

export type TestWorkflowGraphOptions = WorkflowGraphConfig & {
  supervisorLlm: ILLMConnector;
  modelHandlers?: Partial<Record<string, (input: unknown) => unknown>>;
  runtimeAgents?: RuntimeAgentDefinition[];
  defaultModelKey?: string;
  messageHistoryMaxTokens?: number;
  obsidianVaultPath?: string;
};

export const createTestWorkflowGraph = ({
  supervisorLlm,
  modelHandlers = {},
  runtimeAgents = buildTestRuntimeAgents(),
  defaultModelKey = "generic",
  messageHistoryMaxTokens = DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  obsidianVaultPath = "/tmp/vault",
  ...config
}: TestWorkflowGraphOptions) => {
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
    approvedModules: deriveExecutors(runtimeAgents),
  });
  const { promptResolver, policyRegistry } = createAppExecutionKit(deriveExecutors(runtimeAgents), {
    skillCatalog,
  });
  const bundleDeps = createRuntimeToolBundleDeps(obsidianVaultPath, {
    capabilityCatalog: createDefaultCapabilityCatalog(),
    skillCatalog,
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    ...(config.cronJobRepository ? { cronJobRepository: config.cronJobRepository } : {}),
    ...(config.runtimeAgentRepository ? { runtimeAgentRepository: config.runtimeAgentRepository } : {}),
    ...(config.supabaseSession ? { supabaseSession: config.supabaseSession } : {}),
    ...(config.fileSender ? { fileSender: config.fileSender } : {}),
  });

  return createWorkflowGraph({
    supervisorLlm,
    models,
    defaultModelKey,
    executors: deriveExecutors(runtimeAgents),
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    messageHistoryMaxTokens,
    obsidianVaultPath,
    promptResolver,
    policyRegistry,
    bundleDeps,
    ...config,
  });
};
