import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../ports/llm-connector.js";
import { extractMessageTextContent } from "../messages/message-content.js";
import { defaultReplyUxConfig, type ReplyUxConfig } from "./reply-ux.js";

export const findLatestHumanMessageText = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage || message?._getType() === "human") {
      return extractMessageTextContent(message.content).trim();
    }
  }

  return "";
};

export const findLatestAiReplySinceLastHuman = (messages: BaseMessage[]): string => {
  let lastHumanIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage || message?._getType() === "human") {
      lastHumanIndex = index;
      break;
    }
  }

  for (let index = messages.length - 1; index > lastHumanIndex; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (!(message instanceof AIMessage || message._getType() === "ai")) {
      continue;
    }

    const text = extractMessageTextContent(message.content).trim();
    if (text.length > 0 && !isRoutingJson(text)) {
      return text;
    }
  }

  return "";
};

export const isRoutingJson = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && ("next" in parsed || "reply" in parsed);
  } catch {
    return false;
  }
};

export const buildPlainTextReply = async (
  llmConnector: ILLMConnector,
  promptMessages: BaseMessage[],
  supervisorPromptText: string,
  instruction: string,
  config?: RunnableConfig,
): Promise<string> => {
  const fallbackResponse = await llmConnector.getModel().invoke([
    new SystemMessage(`${supervisorPromptText}\n${instruction}`),
    ...promptMessages.slice(1),
  ], config);

  const fallbackText = extractMessageTextContent(fallbackResponse.content).trim();

  if (fallbackText.length > 0) {
    return fallbackText;
  }

  throw new Error("Supervisor final reply model returned an empty response.");
};

export const buildFailureReplyText = async (
  llmConnector: ILLMConnector,
  promptMessages: BaseMessage[],
  supervisorPromptText: string,
  failureContext: string,
  replyUx: ReplyUxConfig = defaultReplyUxConfig,
  config?: RunnableConfig,
): Promise<string> => {
  try {
    return await buildPlainTextReply(
      llmConnector,
      promptMessages,
      supervisorPromptText,
      replyUx.buildFailureReplyInstruction(failureContext),
      config,
    );
  } catch {
    return `I couldn't finish routing your request. ${failureContext}`;
  }
};
