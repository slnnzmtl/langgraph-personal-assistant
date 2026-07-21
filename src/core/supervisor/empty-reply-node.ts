import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../../connectors/llm-connector.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { FINISH_ROUTE } from "../state.js";
import { findLatestHumanMessageText, isRoutingJson } from "./reply-helpers.js";

export const createEmptyReplyNode = (llmConnector: ILLMConnector) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const handoff = state.lastHandoff;
    const agentName = handoff?.agentName ?? "runtime agent";
    const toolContext = handoff?.toolContext?.trim() ?? "";
    const safeFallback = toolContext.length > 0
      ? `${agentName} did not produce a reliable summary. Its last tool result was:\n${toolContext}`
      : `${agentName} did not produce a user-facing reply, and no tool result was available to summarize.`;
    const latestUserRequest = findLatestHumanMessageText(state.messages);
    const finalizerResponse = await llmConnector.getModel().invoke([
      new SystemMessage([
        "You write a final user-facing status message for a specialized agent that stopped without replying.",
        "Return plain text only. Do not return JSON, routing instructions, tool calls, or a plan for future work.",
        "Treat the supplied tool result as authoritative and report only facts it supports.",
        "If it shows the requested state is already present, say it is already present; do not say you will perform the change.",
        "Do not claim a write occurred unless the tool result explicitly proves it.",
        `Specialized agent: ${agentName}`,
        toolContext.length > 0
          ? `Authoritative last tool result:\n${toolContext}`
          : "No tool result is available.",
      ].join("\n\n")),
      new HumanMessage(latestUserRequest || "Provide the status based on the tool result."),
    ], config);
    const finalizerText = extractMessageTextContent(finalizerResponse.content).trim();

    const replyText = finalizerText.length > 0 && !isRoutingJson(finalizerText)
      ? finalizerText
      : safeFallback;

    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      messages: [new AIMessage(replyText)],
    };
  };
