import { AIMessage } from "@langchain/core/messages";
import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "../../src/agent.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/runtime-agent-catalog.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/defaults.js";
import { FakeLLMConnector } from "./fakes.js";

export type TestWorkflowGraphOptions = WorkflowGraphConfig & {
  supervisorLlm: ILLMConnector;
  modelHandlers?: Partial<Record<string, (input: unknown) => unknown>>;
  runtimeAgents?: RuntimeAgentDefinition[];
  defaultModelKey?: string;
};

export const createTestWorkflowGraph = ({
  supervisorLlm,
  modelHandlers = {},
  runtimeAgents = buildDefaultRuntimeAgents(),
  defaultModelKey = "generic",
  ...config
}: TestWorkflowGraphOptions) => {
  const modelKeys = deriveModelKeys(runtimeAgents, defaultModelKey);
  const defaultHandler = () => new AIMessage("ok");
  const models = Object.fromEntries(
    [...modelKeys].map((modelKey) => [
      modelKey,
      new FakeLLMConnector(modelHandlers[modelKey] ?? defaultHandler).getModel(),
    ]),
  );

  return createWorkflowGraph({
    supervisorLlm,
    models,
    defaultModelKey,
    executors: deriveExecutors(runtimeAgents),
    cronTargetAgentIds: deriveCronTargetAgentIds(runtimeAgents),
    ...config,
  });
};

export const createTestWorkflowGraphFromRepository = (
  supervisorLlm: ILLMConnector,
  config: WorkflowGraphConfig,
  repository: RuntimeAgentRepository,
  modelHandlers?: TestWorkflowGraphOptions["modelHandlers"],
) =>
  repository.loadAgents().then((agents) =>
    createTestWorkflowGraph({
      supervisorLlm,
      runtimeAgents: agents,
      modelHandlers,
      ...config,
    }),
  );
