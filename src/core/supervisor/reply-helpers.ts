import {
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
): Promise<string> =>
  buildPlainTextReply(
    llmConnector,
    promptMessages,
    supervisorPromptText,
    replyUx.buildFailureReplyInstruction(failureContext),
    config,
  );
