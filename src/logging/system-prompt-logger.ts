import type { BaseMessage } from "@langchain/core/messages";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const defaultLogsRoot = path.resolve(process.cwd(), "logs");

const isLoggingEnabled = (): boolean => process.env.ENABLE_PROMPT_LOGS !== "false";

const stringifyMessageContent = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part.type === "text") {
          return part.text;
        }

        return JSON.stringify(part);
      })
      .join("\n");
  }

  return JSON.stringify(content);
};

const formatPromptMessages = (messages: BaseMessage[]): string =>
  messages
    .map((message, index) => {
      const messageType = message._getType();
      const body = stringifyMessageContent(message.content);

      return [`[${index}] type=${messageType}`, body].join("\n");
    })
    .join("\n\n");

export const logSystemPromptInvocation = async (
  promptName: string,
  messages: BaseMessage[],
): Promise<void> => {
  if (!isLoggingEnabled()) {
    return;
  }

  try {
    await mkdir(defaultLogsRoot, { recursive: true });

    const logFilePath = path.join(defaultLogsRoot, `${promptName}.txt`);
    const logEntry = [
      `=== ${new Date().toISOString()} ===`,
      formatPromptMessages(messages),
      "",
    ].join("\n");

    await appendFile(logFilePath, logEntry, "utf8");
    // console.log(`[system-prompt:${promptName}]\n${logEntry}`);
  } catch (error) {
    console.error(`Failed to write system prompt log for ${promptName}:`, error);
  }
};