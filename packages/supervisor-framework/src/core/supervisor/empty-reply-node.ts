import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../ports/llm-connector.js";
import { extractMessageTextContent } from "../messages/message-content.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { FINISH_ROUTE } from "../state.js";
import { defaultReplyUxConfig, type ReplyUxConfig } from "./reply-ux.js";
import { findLatestHumanMessageText, isRoutingJson } from "./reply-helpers.js";

export const createEmptyReplyNode = (
  llmConnector: ILLMConnector,
  replyUx: ReplyUxConfig = defaultReplyUxConfig,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const handoff = state.lastHandoff;
    const agentName = handoff?.agentName ?? "runtime agent";
    const toolContext = handoff?.toolContext?.trim() ?? "";
    const latestUserRequest = findLatestHumanMessageText(state.messages);
    const replyContext = { agentName, toolContext, latestUserRequest };
    const safeFallback = replyUx.buildEmptyReplySafeFallback(replyContext);
    const finalizerResponse = await llmConnector.getModel().invoke([
      new SystemMessage(replyUx.buildEmptyReplySystemPrompt(replyContext)),
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
