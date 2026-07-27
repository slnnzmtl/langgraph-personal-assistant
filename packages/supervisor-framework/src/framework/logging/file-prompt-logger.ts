import type { BaseMessage } from "@langchain/core/messages";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { PromptLoggingHook } from "../../core/ports/prompt-logging.js";

export type FilePromptLoggerOptions = {
  logsDir?: string;
  enabled?: boolean | (() => boolean);
};

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

const resolveEnabled = (enabled: FilePromptLoggerOptions["enabled"]): boolean => {
  if (enabled === undefined) {
    return true;
  }

  return typeof enabled === "function" ? enabled() : enabled;
};

export const createFilePromptLogger = (
  options: FilePromptLoggerOptions = {},
): PromptLoggingHook => {
  const logsDir = options.logsDir ?? path.resolve(process.cwd(), "logs");

  return async (
    promptName: string,
    messages: BaseMessage[],
    modelResponse?: BaseMessage[] | string,
  ): Promise<void> => {
    if (!resolveEnabled(options.enabled)) {
      return;
    }

    try {
      await mkdir(logsDir, { recursive: true });

      const logFilePath = path.join(logsDir, `${promptName}.txt`);

      const inputSection = [
        "[Input]",
        formatPromptMessages(messages),
      ].join("\n\n");

      let outputSection = "";
      if (modelResponse) {
        if (typeof modelResponse === "string") {
          outputSection = ["[Model Output]", modelResponse].join("\n\n");
        } else {
          outputSection = ["[Model Output]", formatPromptMessages(modelResponse)].join("\n\n");
        }
      }

      const logEntry = [
        `=== ${new Date().toISOString()} ===`,
        inputSection,
        outputSection,
        "",
      ]
        .filter(Boolean)
        .join("\n\n");

      await appendFile(logFilePath, logEntry, "utf8");
    } catch (error) {
      console.error(`Failed to write system prompt log for ${promptName}:`, error);
    }
  };
};
