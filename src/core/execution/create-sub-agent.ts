import { AIMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import { createSubgraphNodeWrapper } from "./subgraph-wrapper.js";
import { scopeSubAgentMessages } from "./sub-agent-messages.js";
import type { SubAgentToolSource } from "./runtime-node.js";
import {
  SubAgentStateAnnotation,
  type SubAgentState,
  type SubAgentStateUpdate,
} from "./sub-agent-state.js";

export type SubAgentLlmNode = (
  state: SubAgentState,
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
};

export const createCompiledSubAgentGraph = (
  name: string,
  maxSteps: number,
  llmNode: SubAgentLlmNode,
  tools: SubAgentToolSource,
) => {
  const toolNode = new ToolNode(tools);
  const toolsNode = toolNode.invoke.bind(toolNode);

  const graph = new StateGraph(SubAgentStateAnnotation)
    .addNode("llm", llmNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: SubAgentState) => {
      if (state.stepCount >= maxSteps) {
        return END;
      }

      if (hasPendingToolCalls(state.messages) || lastMessageRequestsTools(state.messages)) {
        return "tools";
      }

      return END;
    })
    .addConditionalEdges("tools", (state: SubAgentState) => {
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }

      return "llm";
    });

  return graph.compile({ name: `${name.toLowerCase()}-subgraph` });
};

export const createSubAgent = <TDeps>(config: SubAgentConfig<TDeps>) => {
  const tools = config.createTools(config.deps);
  const llmNode = config.createLlmNode(config.deps, tools);
  const compiledSubgraph = createCompiledSubAgentGraph(config.name, config.maxSteps, llmNode, tools);

  return createSubgraphNodeWrapper<SubAgentState>({
    subgraphName: config.name,
    buildInitialState:
      config.buildInitialState
      ?? ((parentState) => ({
        messages: scopeSubAgentMessages(parentState.messages),
        stepCount: 0,
      })),
    compiledSubgraph,
    ...(config.mapResult
      ? {
          mapResult: (result: SubAgentState) =>
            config.mapResult!(result, { maxSteps: config.maxSteps, name: config.name }),
        }
      : {}),
  });
};

export const createSubAgentOrStub = <TDeps>(
  isAvailable: (deps: TDeps) => boolean,
  unavailableMessage: string,
  config: SubAgentConfig<TDeps>,
) => {
  if (!isAvailable(config.deps)) {
    return async (_state: AgentState): Promise<AgentStateUpdate> => ({
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

  const lastMessage = result.messages[result.messages.length - 1];
  return {
    messages: [lastMessage as AIMessage],
  };
};
