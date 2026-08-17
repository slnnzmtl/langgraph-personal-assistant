import { END, START, StateGraph } from "@langchain/langgraph";

import {
  createSubAgentStateAnnotation,
  createSubAgentToolsNode,
  hasPendingToolCalls,
  lastMessageRequestsTools,
  SubAgentStateAnnotation,
  type SubAgentLlmNode,
  type SubAgentState,
  type SubAgentToolSource,
} from "@personal-assistant/supervisor-framework";

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
      if (hasPendingToolCalls(state.agentMessages) || lastMessageRequestsTools(state.agentMessages)) {
        return "tools";
      }

      return END;
    })
    .addConditionalEdges("tools", (state: SubAgentState) => {
      if (hasPendingToolCalls(state.agentMessages)) {
        return "tools";
      }

      if (state.stepCount >= maxSteps) {
        return END;
      }

      return "llm";
    });

  return graph.compile({ name: `${name.toLowerCase()}-subgraph` });
};
