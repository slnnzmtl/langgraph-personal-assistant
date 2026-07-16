import { AIMessage, HumanMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../../utils/message-content.js";

/** Keep only the latest user turn and any sub-agent messages appended after it. */
export const scopeSubAgentMessages = (messages: BaseMessage[]): BaseMessage[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      return messages.slice(index);
    }
  }

  return messages;
};

export const buildRuntimeAgentPromptMessages = (
  systemInstructions: BaseMessage,
  stateMessages: BaseMessage[],
): BaseMessage[] => {
  const conversation = [systemInstructions, ...stateMessages];
  const hasToolMessages = stateMessages.some((message) => message._getType() === "tool");

  return hasToolMessages ? conversation : mergeMessageRuns(conversation);
};

export const isEmptyModelResponse = (response: AIMessage): boolean => {
  const responseText = extractMessageTextContent(response.content).trim();
  const toolCalls = response.tool_calls ?? [];

  return responseText.length === 0 && toolCalls.length === 0;
};
