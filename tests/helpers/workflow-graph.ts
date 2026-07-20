import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "../../src/agent.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/runtime-agent-catalog.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "../../src/core/message-trimming.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/builtin-domains.js";
import { FakeLLMConnector } from "./fakes.js";

export type TestWorkflowGraphOptions = WorkflowGraphConfig & {
  supervisorLlm: ILLMConnector;
  modelHandlers?: Partial<Record<string, (input: unknown) => unknown>>;
  runtimeAgents?: RuntimeAgentDefinition[];
  defaultModelKey?: string;
  messageHistoryMaxTokens?: number;
};

export const createTestWorkflowGraph = ({
  supervisorLlm,
  modelHandlers = {},
  runtimeAgents = buildDefaultRuntimeAgents(),
  defaultModelKey = "generic",
  messageHistoryMaxTokens = DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
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

  return createWorkflowGraph({
    supervisorLlm,
    models,
    defaultModelKey,
    executors: deriveExecutors(runtimeAgents),
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    messageHistoryMaxTokens,
    ...config,
  });
};
