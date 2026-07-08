import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";

import type { AppConfig } from "../config.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { SupabaseMcpSession } from "../packages/finance-server/src/index.js";
import { createFinanceTools, createFinanceNode } from "../nodes/finance-node/src/index.js";
import { createObsidianNode } from "../nodes/obsidian/obsidian-node.js";
import { createObsidianTools } from "../nodes/obsidian/obsidian-tools.js";
import { createSupervisorNode } from "../nodes/supervisor-node.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "../state.js";

export const createWorkflowGraph = (
  supervisorLlmConnector: ILLMConnector,
  obsidianLlmConnector: ILLMConnector,
  financeLlmConnector: ILLMConnector,
  config: Pick<AppConfig, "obsidianVaultPath" | "appTimezone"> & { supabaseSession?: SupabaseMcpSession },
) => {
  const supervisorNode = createSupervisorNode(supervisorLlmConnector);
  const obsidianNode = createObsidianNode(obsidianLlmConnector, config.obsidianVaultPath);
  const obsidianToolsNode = new ToolNode(createObsidianTools(config.obsidianVaultPath));
  const memory = new MemorySaver();

  // Create finance node and tools: if supabaseSession is provided, set up tool execution loop
  const financeTools = config.supabaseSession ? createFinanceTools(config.supabaseSession) : undefined;
  const financeToolsNode = financeTools ? new ToolNode(financeTools) : undefined;
  
  const financeNode = config.supabaseSession
    ? createFinanceNode(financeLlmConnector.getModel(), financeTools!)
    : async (_state: AgentState) => ({
        messages: [new AIMessage("Finance sync not configured. Enable ENABLE_FINANCE_SYNC and provide Supabase credentials.")],
      });

  // Build graph - add all nodes upfront
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("finance", financeNode)
    .addNode("obsidian", obsidianNode)
    .addNode("obsidianTools", obsidianToolsNode);

  // Add financeTools node if finance sync is configured
  if (financeToolsNode) {
    (graph as any).addNode("financeTools", financeToolsNode);
  }

  // Add supervisor edges
  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Finance_SG: "finance",
        Obsidian_SG: "obsidian",
        FINISH: END,
      } satisfies Record<RouteName, "finance" | "obsidian" | typeof END>,
    );

  // Add finance tool loop if session is configured
  if (financeToolsNode) {
    // TypeScript doesn't track conditional node additions well, so we use type assertions
    (graph as any).addConditionalEdges("finance", (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "financeTools";
      }
      return "supervisor";
    });
    (graph as any).addEdge("financeTools", "finance");
  } else {
    graph.addEdge("finance", "supervisor");
  }

  // Add obsidian tool loop
  graph.addConditionalEdges("obsidian", (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "obsidianTools";
    }

    // Legacy fallback guard for Gemini function call format
    if (lastMessage && typeof lastMessage === "object" && "additional_kwargs" in lastMessage) {
      if ((lastMessage as any).additional_kwargs?.functionCall) return "obsidianTools";
    }

    return "supervisor";
  });
  graph.addEdge("obsidianTools", "obsidian");

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};