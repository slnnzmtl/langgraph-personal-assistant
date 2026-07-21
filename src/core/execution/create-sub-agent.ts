import { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import {
  type RuntimeAgentGraphBundle,
  type RuntimeAgentLoopNode,
} from "../agents/runtime-agent-graph-bundle.js";
import { scopeSubAgentMessages } from "./sub-agent-messages.js";
import type { SubAgentToolSource } from "./runtime-node.js";
import {
  createSubAgentStateAnnotation,
  SubAgentStateAnnotation,
  type SubAgentState,
  type SubAgentStateUpdate,
} from "./sub-agent-state.js";

export type SubAgentLlmNode = RuntimeAgentLoopNode;

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

export const createSubAgentToolsNode = (tools: SubAgentToolSource): RuntimeAgentLoopNode => {
  const toolNode = new ToolNode(tools);

  return async (state: SubAgentState, config?: RunnableConfig): Promise<SubAgentStateUpdate> => {
    // Call ToolNode.run directly — toolNode.invoke() nests another Runnable and
    // re-triggers the LangChainTracer duplicate-handler bug (langchainjs#11189).
    const result = await (
      toolNode as unknown as {
        run(
          input: { messages: SubAgentState["agentMessages"] },
          config?: RunnableConfig,
        ): Promise<{ messages: SubAgentState["agentMessages"] }>;
      }
    ).run({ messages: state.agentMessages }, config);

    return { agentMessages: result.messages };
  };
};

/** Isolated compiled loop for unit tests only — do not mount under a parent graph. */
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
  const toolsNode = createSubAgentToolsNode(tools);

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
  const toolsNode = createSubAgentToolsNode(tools);

  return {
    name: config.name,
    maxSteps: config.maxSteps,
    prepare:
      config.buildInitialState
      ?? ((parentState) => ({
        agentMessages: scopeSubAgentMessages(parentState.messages),
        stepCount: 0,
      })),
    llmNode,
    toolsNode,
    finalize: config.mapResult
      ? (result) => config.mapResult!(result, { maxSteps: config.maxSteps, name: config.name })
      : (result) => mapDefaultSubAgentResult(result, { maxSteps: config.maxSteps, name: config.name }),
  };
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
