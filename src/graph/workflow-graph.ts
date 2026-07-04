import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { financeMockNode } from "../nodes/finance-mock-node.js";
import { createObsidianNode } from "../nodes/obsidian-node.js";
import { createSupervisorNode } from "../nodes/supervisor-node.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "../state.js";

export const createWorkflowGraph = (llmConnector: ILLMConnector) => {
  const supervisorNode = createSupervisorNode(llmConnector);
  const obsidianNode = createObsidianNode(llmConnector);
  const memory = new MemorySaver();

  return new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("finance", financeMockNode)
    .addNode("obsidian", obsidianNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Finance_SG: "finance",
        Obsidian_SG: "obsidian",
        FINISH: END,
      } satisfies Record<RouteName, "finance" | "obsidian" | typeof END>,
    )
    .addEdge("finance", END)
    .addEdge("obsidian", END)
    .compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};