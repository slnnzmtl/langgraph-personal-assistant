import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "./ports/llm-connector.js";
import type { PromptLoggingHook } from "./ports/prompt-logging.js";
import {
  buildRuntimeAgentGraphNodeSets,
  createRuntimeAgentFinalizeNode,
  createRuntimeAgentPrepareNode,
  routeAfterRuntimeAgentLlm,
  routeAfterRuntimeAgentTools,
} from "./agents/build-runtime-agent-nodes.js";
import type { LoadPromptByKey } from "./agents/resolve-system-prompt.js";
import type { RuntimeAgentRepository } from "./agents/repository.js";
import { createRuntimeAgentExecutionContext } from "./execution/context.js";
import type { RuntimeAgentPolicy } from "./types/policy.js";
import type { RuntimeAgentDefinition } from "./types/agent.js";
import { createSupervisorNode } from "./supervisor/supervisor-node.js";
import type { ContextCacheKit } from "./llm/context-cache-types.js";
import {
  createEmptyReplyNode,
  createFailureReplyNode,
  createPostHandoffFinishNode,
} from "./supervisor/reply-nodes.js";
import { defaultReplyUxConfig, type ReplyUxConfig } from "./supervisor/reply-ux.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "./message-trimming.js";
import {
  createAgentStateAnnotation,
  EMPTY_REPLY_ROUTE,
  FAILURE_REPLY_ROUTE,
  FINISH_ROUTE,
  POST_HANDOFF_FINISH_ROUTE,
  type AgentState,
} from "./state.js";

export type AssistantConfig<TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>> = {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  runtimeAgents: RuntimeAgentDefinition[];
  runtimeAgentRepository: RuntimeAgentRepository;
  capabilityDeps: TCapabilityDeps;
  loadPromptByKey: LoadPromptByKey;
  loadSupervisorPrompt: () => string;
  buildSupervisorDynamicContext?: () => string;
  contextCache?: ContextCacheKit;
  runtimeAgentPolicy: RuntimeAgentPolicy;
  replyUx?: ReplyUxConfig;
  promptLogging?: PromptLoggingHook;
  cronTriggerResolver?: Parameters<typeof createSupervisorNode>[1]["cronTriggerResolver"];
  checkpointer?: BaseCheckpointSaver;
  graphName?: string;
  messageHistoryMaxTokens?: number;
  maxErrorRetries?: number;
};

export const createAssistant = <TCapabilityDeps extends Record<string, unknown>>(
  config: AssistantConfig<TCapabilityDeps>,
) => {
  const replyUx = config.replyUx ?? defaultReplyUxConfig;

  const memory = config.checkpointer ?? new MemorySaver();
  const executionContext = createRuntimeAgentExecutionContext({
    models: config.models,
    ...(config.defaultModelKey ? { defaultModelKey: config.defaultModelKey } : {}),
    repository: config.runtimeAgentRepository,
    capabilityDeps: config.capabilityDeps,
    loadPromptByKey: config.loadPromptByKey,
    runtimeAgentPolicy: config.runtimeAgentPolicy,
    ...(config.promptLogging ? { promptLogging: config.promptLogging } : {}),
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
    ...(config.buildSupervisorDynamicContext
      ? { buildSupervisorDynamicContext: config.buildSupervisorDynamicContext }
      : {}),
    ...(config.contextCache ? { contextCache: config.contextCache } : {}),
    ...(config.promptLogging ? { promptLogging: config.promptLogging } : {}),
    ...(config.cronTriggerResolver ? { cronTriggerResolver: config.cronTriggerResolver } : {}),
    ...(config.maxErrorRetries !== undefined ? { maxErrorRetries: config.maxErrorRetries } : {}),
  });

  const failureReplyNode = createFailureReplyNode(config.supervisorLlm, {
    loadSupervisorPrompt: () => {
      const base = config.loadSupervisorPrompt().trim();
      const dynamic = config.buildSupervisorDynamicContext?.().trim() ?? "";
      return dynamic.length > 0 ? `${base}\n\n${dynamic}` : base;
    },
    replyUx,
  });

  const graph = new StateGraph(agentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode(EMPTY_REPLY_ROUTE, createEmptyReplyNode(config.supervisorLlm, replyUx))
    .addNode(FAILURE_REPLY_ROUTE, failureReplyNode)
    .addNode(POST_HANDOFF_FINISH_ROUTE, createPostHandoffFinishNode(config.supervisorLlm, replyUx));

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
    [EMPTY_REPLY_ROUTE]: EMPTY_REPLY_ROUTE,
    [FAILURE_REPLY_ROUTE]: FAILURE_REPLY_ROUTE,
    [POST_HANDOFF_FINISH_ROUTE]: POST_HANDOFF_FINISH_ROUTE,
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
    )
    .addEdge(EMPTY_REPLY_ROUTE, END)
    .addEdge(FAILURE_REPLY_ROUTE, END)
    .addEdge(POST_HANDOFF_FINISH_ROUTE, END);

  return graph.compile({
    checkpointer: memory,
    name: config.graphName ?? "personal-assistant",
  });
};
