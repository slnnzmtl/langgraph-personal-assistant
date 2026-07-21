import { END, START, StateGraph } from "@langchain/langgraph";

import {
  createSubAgentToolsNode,
  type SubAgentLlmNode,
} from "../../src/core/execution/create-sub-agent.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../src/tools/routing.js";
import type { SubAgentToolSource } from "../../src/core/execution/runtime-node.js";
import {
  createSubAgentStateAnnotation,
  SubAgentStateAnnotation,
  type SubAgentState,
} from "../../src/core/execution/sub-agent-state.js";

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
