import type { BaseMessage } from "@langchain/core/messages";
import { extractMessageTextContent } from "@personal-assistant/supervisor-framework";

export const formatMessageContent = (
  content: BaseMessage["content"] | undefined,
): string => {
  if (content === undefined) {
    return "";
  }

  return extractMessageTextContent(content).trim();
};
