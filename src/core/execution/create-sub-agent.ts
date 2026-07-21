import { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import {
  graphBundleToHandler,
  type RuntimeAgentGraphBundle,
} from "../agents/runtime-agent-graph-bundle.js";
import { scopeSubAgentMessages } from "./sub-agent-messages.js";
import type { SubAgentToolSource } from "./runtime-node.js";
import {
  createSubAgentStateAnnotation,
  SubAgentStateAnnotation,
  type SubAgentState,
  type SubAgentStateUpdate,
} from "./sub-agent-state.js";

export type SubAgentLlmNode = (
  state: SubAgentState,
  config?: RunnableConfig,
) => Promise<SubAgentStateUpdate>;

export type SubAgentConfig<TDeps> = {
  name: string;
  maxSteps: number;
  deps: TDeps;
  createTools: (deps: TDeps) => SubAgentToolSource;
  createLlmNode: (deps: TDeps, tools: SubAgentToolSource) => SubAgentLlmNode;
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
  buildInitialState?: (parentState: AgentState) => SubAgentState;
  messageHistoryMaxTokens?: number;
};

const createToolsNode = (tools: SubAgentToolSource) => {
  const toolNode = new ToolNode(tools);

  return async (state: SubAgentState, config?: RunnableConfig): Promise<SubAgentStateUpdate> => {
    const result = await toolNode.invoke({ messages: state.agentMessages }, config);
    return { agentMessages: result.messages };
  };
};

export const createCompiledSubAgentGraph = (
  name: string,
  maxSteps: number,
  llmNode: SubAgentLlmNode,
  tools: SubAgentToolSource,
  options?: { messageHistoryMaxTokens?: number },
) => {
  const stateAnnotation = options?.messageHistoryMaxTokens
    ? createSubAgentStateAnnotation({ messageHistoryMaxTokens: options.messageHistoryMaxTokens })
    : SubAgentStateAnnotation;
  const toolsNode = createToolsNode(tools);

  const graph = new StateGraph(stateAnnotation)
    .addNode("llm", llmNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: SubAgentState) => {
      if (state.stepCount >= maxSteps) {
        return END;
      }

      if (hasPendingToolCalls(state.agentMessages) || lastMessageRequestsTools(state.agentMessages)) {
        return "tools";
      }

      return END;
    })
    .addConditionalEdges("tools", (state: SubAgentState) => {
      if (hasPendingToolCalls(state.agentMessages)) {
        return "tools";
      }

      return "llm";
    });

  return graph.compile({ name: `${name.toLowerCase()}-subgraph` });
};

export const createSubAgentGraphBundle = <TDeps>(config: SubAgentConfig<TDeps>): RuntimeAgentGraphBundle => {
  const tools = config.createTools(config.deps);
  const llmNode = config.createLlmNode(config.deps, tools);
  const compiledSubgraph = createCompiledSubAgentGraph(
    config.name,
    config.maxSteps,
    llmNode,
    tools,
    config.messageHistoryMaxTokens
      ? { messageHistoryMaxTokens: config.messageHistoryMaxTokens }
      : undefined,
  );

  return {
    name: config.name,
    prepare:
      config.buildInitialState
      ?? ((parentState) => ({
        agentMessages: scopeSubAgentMessages(parentState.messages),
        stepCount: 0,
      })),
    subgraph: compiledSubgraph,
    finalize: config.mapResult
      ? (result) => config.mapResult!(result, { maxSteps: config.maxSteps, name: config.name })
      : (result) => mapDefaultSubAgentResult(result, { maxSteps: config.maxSteps, name: config.name }),
  };
};

export const createSubAgent = <TDeps>(config: SubAgentConfig<TDeps>) =>
  graphBundleToHandler(createSubAgentGraphBundle(config));

export const createSubAgentOrStub = <TDeps>(
  isAvailable: (deps: TDeps) => boolean,
  unavailableMessage: string,
  config: SubAgentConfig<TDeps>,
) => {
  if (!isAvailable(config.deps)) {
    return async (_state: AgentState, _config?: RunnableConfig): Promise<AgentStateUpdate> => ({
      messages: [new AIMessage(unavailableMessage)],
    });
  }

  return createSubAgent(config);
};

export const createMaxStepsExceededUpdate = (
  name: string,
  maxSteps: number,
  message?: string,
): AgentStateUpdate => ({
  messages: [
    new AIMessage(
      message ?? `Unable to complete ${name}: exceeded the maximum of ${maxSteps} tool steps.`,
    ),
  ],
});

export const mapDefaultSubAgentResult = (
  result: SubAgentState,
  { maxSteps, name }: { maxSteps: number; name: string },
  options?: { maxStepsMessage?: string },
): AgentStateUpdate => {
  if (result.stepCount >= maxSteps) {
    return createMaxStepsExceededUpdate(name, maxSteps, options?.maxStepsMessage);
  }

  const lastMessage = result.agentMessages[result.agentMessages.length - 1];
  return {
    messages: [lastMessage as AIMessage],
  };
};

export { createDefaultPrepare } from "../agents/runtime-agent-graph-bundle.js";