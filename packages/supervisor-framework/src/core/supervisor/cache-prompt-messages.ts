import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent, extractNonTextContentParts } from "../message-content.js";

export const buildTurnContextMessage = (dynamicContext: string): HumanMessage | null => {
  const trimmed = dynamicContext.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return new HumanMessage(`<turn_context>\n${trimmed}\n</turn_context>`);
};

export const buildCachedRuntimePromptMessages = (
  dynamicContext: string,
  stateMessages: BaseMessage[],
): BaseMessage[] => {
  const turnContext = buildTurnContextMessage(dynamicContext);
  if (!turnContext) {
    return [...stateMessages];
  }

  const lastMessage = stateMessages[stateMessages.length - 1];
  const lastIsHuman =
    lastMessage !== undefined
    && (lastMessage instanceof HumanMessage || lastMessage._getType() === "human");

  if (lastIsHuman) {
    const prefixedText = `${extractMessageTextContent(turnContext.content)}\n${extractMessageTextContent(lastMessage.content)}`.trim();
    const nonTextParts = extractNonTextContentParts(lastMessage.content);
    const prefixed = nonTextParts.length > 0
      ? new HumanMessage([{ type: "text", text: prefixedText }, ...nonTextParts])
      : new HumanMessage(prefixedText);
    return [...stateMessages.slice(0, -1), prefixed];
  }

  return [...stateMessages, turnContext];
};
