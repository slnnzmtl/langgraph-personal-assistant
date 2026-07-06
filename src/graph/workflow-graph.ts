import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseMessage } from "@langchain/core/messages";

import type { AppConfig } from "../config.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import { financeMockNode } from "../nodes/finance-mock-node.js";
import { createObsidianNode, createObsidianTools } from "../nodes/obsidian/obsidian-node.js";
import { createSupervisorNode } from "../nodes/supervisor-node.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "../state.js";

export const createWorkflowGraph = (
  llmConnector: ILLMConnector,
  config: Pick<AppConfig, "obsidianVaultPath" | "appTimezone">,
) => {
  const supervisorNode = createSupervisorNode(llmConnector);
  const obsidianNode = createObsidianNode(llmConnector, config.obsidianVaultPath, config.appTimezone);
  const obsidianToolsNode = new ToolNode(createObsidianTools(config.obsidianVaultPath));
  const memory = new MemorySaver();

  return new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("finance", financeMockNode)
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
    .addEdge("finance", END)
    .addConditionalEdges("obsidian", (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (!lastMessage || typeof lastMessage !== "object") return "supervisor";

      const hasToolCalls =
        "tool_calls" in lastMessage &&
        Array.isArray(lastMessage.tool_calls) &&
        lastMessage.tool_calls.length > 0;

      const hasLegacyFunctionCall = Boolean(
        (lastMessage as BaseMessage & { additional_kwargs?: Record<string, unknown> })
          .additional_kwargs?.functionCall,
      );

      if (hasToolCalls || hasLegacyFunctionCall) {
        return "obsidianTools";
      }

      if (
        "content" in lastMessage &&
        typeof lastMessage.content === "string" &&
        lastMessage.content.startsWith("Unable to edit the local markdown vault:")
      ) {
        return END;
      }

      return END;
    })
    .addEdge("obsidianTools", "obsidian")
    .compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};