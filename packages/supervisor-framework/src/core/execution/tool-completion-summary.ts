import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { isConsumedToolMarker } from "../message-compaction.js";
import { extractMessageTextContent } from "../messages/message-content.js";
import type { SubAgentState } from "./sub-agent-state.js";

export type ToolBodyPredicate = (content: string) => boolean;

export const defaultConsumableToolBody: ToolBodyPredicate = (content) => {
  const trimmed = content.trim();
  return trimmed.length > 0
    && !isConsumedToolMarker(trimmed)
    && !trimmed.startsWith("Error:");
};

export const buildLatestToolCompletionSummary = (
  messages: BaseMessage[],
  isConsumable: ToolBodyPredicate = defaultConsumableToolBody,
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) {
      continue;
    }

    const content = extractMessageTextContent(message.content).trim();
    if (!isConsumable(content)) {
      continue;
    }

    return content;
  }

  return undefined;
};

export const hasCompletedAgentReply = (
  message: BaseMessage | undefined,
  completionFallback: string,
): message is AIMessage =>
  message instanceof AIMessage
  && !(message.tool_calls?.length)
  && extractMessageTextContent(message.content).trim().length > 0
  && extractMessageTextContent(message.content).trim() !== completionFallback;

export const processBlankToolLoopResponse = (
  ctx: { state: SubAgentState },
  response: AIMessage,
  options: {
    completionFallback: string;
    buildSummary: (messages: BaseMessage[]) => string | undefined;
  },
): AIMessage => {
  const responseText = extractMessageTextContent(response.content).trim();
  const toolCalls = response.tool_calls ?? [];

  if (toolCalls.length > 0 || responseText.length > 0) {
    return response;
  }

  const hasToolResults = ctx.state.agentMessages.some((message) => message instanceof ToolMessage);
  if (!hasToolResults) {
    return new AIMessage(options.completionFallback);
  }

  const summary = options.buildSummary(ctx.state.agentMessages);
  if (summary) {
    return new AIMessage(summary);
  }

  return new AIMessage({ content: "" });
};
