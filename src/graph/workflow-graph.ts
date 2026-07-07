import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";

import type { AppConfig } from "../config.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { SupabaseMcpSession } from "../packages/finance-server/src/index.js";
import { createFinanceSubgraphNode } from "../nodes/finance-node/src/index.js";
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

  // Create finance node: use real sub-graph if supabaseSession is provided, otherwise use fallback
  const financeNode = config.supabaseSession
    ? createFinanceSubgraphNode(config.supabaseSession, financeLlmConnector.getModel())
    : async (_state: AgentState) => ({
        messages: [new AIMessage("Finance sync not configured. Enable ENABLE_FINANCE_SYNC and provide Supabase credentials.")],
      });

  return new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("finance", financeNode)
    .addNode("obsidian", obsidianNode)
    .addNode("obsidianTools", obsidianToolsNode)
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
    .addEdge("finance", "supervisor")
    .addConditionalEdges("obsidian", (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "obsidianTools";
      }

      // Legacy fallback guard for Gemini function call format
      if (lastMessage && typeof lastMessage === "object" && "additional_kwargs" in lastMessage) {
        if ((lastMessage as any).additional_kwargs?.functionCall) return "obsidianTools";
      }

      return "supervisor";
    })
    .addEdge("obsidianTools", "obsidian")
    .compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};