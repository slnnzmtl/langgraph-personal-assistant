import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { CronJobRepository, RuntimeCronService } from "../cron/types.js";
import {
  buildRuntimeAgentGraphNodeSets,
  createRuntimeAgentFinalizeNode,
  createRuntimeAgentPrepareNode,
  routeAfterRuntimeAgentLlm,
  routeAfterRuntimeAgentTools,
} from "./agents/build-runtime-agent-nodes.js";
import { createPromptResolver, type PromptResolver } from "./agents/prompt-resolver.js";
import type { RuntimeAgentRepository } from "./agents/repository.js";
import { createRuntimeAgentExecutionContext } from "./execution/context.js";
import { createGenericPolicy, type GenericPolicyDeps } from "./policies/generic.js";
import { createPolicyRegistry, type PolicyRegistry } from "./policies/registry.js";
import type { RuntimeAgentPolicy } from "./types/policy.js";
import type { RuntimeAgentDefinition } from "./types/agent.js";
import { createSupervisorNode } from "./supervisor/supervisor-node.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "./message-trimming.js";
import { createAgentStateAnnotation, FINISH_ROUTE, type AgentState } from "./state.js";

export type AssistantConfig = {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  runtimeAgents: RuntimeAgentDefinition[];
  runtimeAgentRepository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps?: Record<string, unknown>;
  loadPromptByKey?: (key: string) => string;
  loadSupervisorPrompt: () => string;
  policies?: RuntimeAgentPolicy[];
  genericPolicyDeps?: GenericPolicyDeps;
  cronTriggerResolver?: Parameters<typeof createSupervisorNode>[1]["cronTriggerResolver"];
  resolveAgentId?: (routeOrId: string) => string;
  checkpointer?: MemorySaver;
  graphName?: string;
  messageHistoryMaxTokens?: number;
  promptResolver?: PromptResolver;
  policyRegistry?: PolicyRegistry;
};

export const createAssistant = (config: AssistantConfig) => {
  const promptResolver = config.promptResolver
    ?? (config.loadPromptByKey
      ? createPromptResolver(config.loadPromptByKey)
      : (() => { throw new Error("createAssistant requires promptResolver or loadPromptByKey."); })());

  const policyRegistry = config.policyRegistry
    ?? (config.policies && config.genericPolicyDeps
      ? createPolicyRegistry([
        createGenericPolicy(config.genericPolicyDeps),
        ...config.policies,
      ])
      : (() => { throw new Error("createAssistant requires policyRegistry or policies with genericPolicyDeps."); })());

  const memory = config.checkpointer ?? new MemorySaver();
  const executionContext = createRuntimeAgentExecutionContext({
    models: config.models,
    ...(config.defaultModelKey ? { defaultModelKey: config.defaultModelKey } : {}),
    repository: config.runtimeAgentRepository,
    cronJobRepository: config.cronJobRepository,
    ...(config.runtimeCron ? { runtimeCron: config.runtimeCron } : {}),
    ...(config.bundleDeps ? { bundleDeps: config.bundleDeps } : {}),
    promptResolver,
    policyRegistry,
  });

  const agentStateAnnotation = createAgentStateAnnotation({
    messageHistoryMaxTokens: config.messageHistoryMaxTokens ?? DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  });
  const runtimeAgentNodeSets = buildRuntimeAgentGraphNodeSets(config.runtimeAgents, executionContext);
  const wiredAgentIds = new Set(runtimeAgentNodeSets.map((nodeSet) => nodeSet.agentId));

  const supervisorNode = createSupervisorNode(config.supervisorLlm, {
    runtimeAgentRepository: config.runtimeAgentRepository,
    wiredAgentIds,
    loadSupervisorPrompt: config.loadSupervisorPrompt,
    ...(config.cronTriggerResolver ? { cronTriggerResolver: config.cronTriggerResolver } : {}),
    ...(config.resolveAgentId ? { resolveAgentId: config.resolveAgentId } : {}),
  });

  const graph = new StateGraph(agentStateAnnotation).addNode("supervisor", supervisorNode);

  for (const nodeSet of runtimeAgentNodeSets) {
    const { bundle } = nodeSet;

    graph
      .addNode(nodeSet.prepareNodeName, createRuntimeAgentPrepareNode(bundle))
      .addNode(nodeSet.llmNodeName, bundle.llmNode)
      .addNode(nodeSet.toolsNodeName, bundle.toolsNode)
      .addNode(nodeSet.finalizeNodeName, createRuntimeAgentFinalizeNode(bundle, nodeSet.agentId))
      .addEdge(nodeSet.prepareNodeName, nodeSet.llmNodeName)
      .addConditionalEdges(
        nodeSet.llmNodeName,
        (state: AgentState) =>
          routeAfterRuntimeAgentLlm(
            state,
            bundle.maxSteps,
            nodeSet.toolsNodeName,
            nodeSet.finalizeNodeName,
          ),
        {
          [nodeSet.toolsNodeName]: nodeSet.toolsNodeName,
          [nodeSet.finalizeNodeName]: nodeSet.finalizeNodeName,
        },
      )
      .addConditionalEdges(
        nodeSet.toolsNodeName,
        (state: AgentState) =>
          routeAfterRuntimeAgentTools(state, nodeSet.llmNodeName, nodeSet.toolsNodeName),
        {
          [nodeSet.llmNodeName]: nodeSet.llmNodeName,
          [nodeSet.toolsNodeName]: nodeSet.toolsNodeName,
        },
      )
      .addEdge(nodeSet.finalizeNodeName, "supervisor");
  }

  const supervisorRoutes: Record<string, string | typeof END> = {
    [FINISH_ROUTE]: END,
  };

  for (const nodeSet of runtimeAgentNodeSets) {
    supervisorRoutes[nodeSet.agentId] = nodeSet.prepareNodeName;
  }

  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? FINISH_ROUTE,
      supervisorRoutes as Record<string, typeof END>,
    );

  return graph.compile({
    checkpointer: memory,
    name: config.graphName ?? "personal-assistant",
  });
};
