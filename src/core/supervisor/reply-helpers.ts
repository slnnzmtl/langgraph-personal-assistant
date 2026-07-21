import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../../connectors/llm-connector.js";
import { extractMessageTextContent } from "../messages/message-content.js";

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
  config?: RunnableConfig,
): Promise<string> =>
  buildPlainTextReply(
    llmConnector,
    promptMessages,
    supervisorPromptText,
    `The normal supervisor routing failed. Produce the final user-facing reply in plain text. Explain the issue briefly and helpfully, and do not output JSON or call tools. Failure context: ${failureContext}`,
    config,
  );
