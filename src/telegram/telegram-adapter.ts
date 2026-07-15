import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { Telegraf } from "telegraf";
import type { Context } from "telegraf";

import type { AppConfig } from "../config.js";
import type { createWorkflowGraph } from "../graph/workflow-graph.js";
import type { AgentState } from "../state.js";
import type { IFileSender } from "./file-sender.js";
import { GraphRecursionError } from "@langchain/langgraph";

export interface ITelegramAdapter {
  parseInbound(ctx: Context): Promise<HumanMessage | null>;
  triggerWorkflow(message: HumanMessage, threadId: string): Promise<AgentState>;
  sendOutbound(ctx: Context, stateMessages: BaseMessage[]): Promise<void>;
  launch(): Promise<void>;
}

export const extractTelegramMessageText = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") {
    return content.replaceAll("\\n", "\n");
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

        return "[non-text content omitted]";
      })
      .join("\n")
      .replaceAll("\\n", "\n");
  }

  return JSON.stringify(content);
};

const truncateForLog = (value: string, maxLength = 500): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

const logTelegramMessage = (role: "user" | "bot", text: string): void => {
  console.log(`${role}: ${truncateForLog(text)}`);
};

const TELEGRAM_MARKDOWN_V2_RESERVED_CHARACTERS = /[\\_*\[\]()~`>#+\-=|{}.!]/g;

const escapeTelegramMarkdownV2Text = (text: string): string =>
  text.replace(TELEGRAM_MARKDOWN_V2_RESERVED_CHARACTERS, "\\$&");

const escapeTelegramMarkdownV2Url = (text: string): string => text.replace(/[\\)]/g, "\\$&");

export const formatTelegramMarkdownV2 = (text: string): string => {
  const tokens: string[] = [];
  const createToken = (value: string): string => {
    tokens.push(value);

    return `\u0000${tokens.length - 1}\u0000`;
  };

  const withTokens = text
    .replace(/\*\*(.+?)\*\*/g, (_match, boldText: string) => createToken(`*${escapeTelegramMarkdownV2Text(boldText)}*`))
    .replace(/\[((?:\\.|[^\]])+?)\]\(((?:\\.|[^)])+?)\)/g, (_match, linkText: string, url: string) =>
      createToken(`[${escapeTelegramMarkdownV2Text(linkText)}](${escapeTelegramMarkdownV2Url(url)})`),
    );

  const escapedText = escapeTelegramMarkdownV2Text(withTokens);

  return escapedText.replace(/\u0000(\d+)\u0000/g, (_match, tokenIndex: string) => tokens[Number(tokenIndex)] ?? "");
};

/**
 * Split a message into chunks that fit within Telegram's 4096 character limit.
 * Prefers to split on newline boundaries to preserve readability and avoid breaking MarkdownV2 tags.
 * Falls back to hard character split if a single line exceeds the limit.
 */
export const splitMessage = (text: string, maxLength = 4096): string[] => {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let currentChunk = "";

  for (const line of lines) {
    // If a single line exceeds max length, hard-split it
    if (line.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      // Hard-split the oversized line
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
      continue;
    }

    // Try to add the line to the current chunk
    const testChunk = currentChunk ? currentChunk + "\n" + line : line;
    if (testChunk.length <= maxLength) {
      currentChunk = testChunk;
    } else {
      // Current chunk is full, flush it and start a new one
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    }
  }

  // Flush remaining chunk
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
};

const sendSystemError = async (ctx: Context, text: string): Promise<void> => {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    console.error("Unable to determine chat ID for system error message.");
    return;
  }

  await ctx.telegram.sendMessage(chatId, text);
};

const sendChunk = async (telegram: Context["telegram"], chatId: number, chunk: string): Promise<void> => {
  try {
    await telegram.sendMessage(chatId, formatTelegramMarkdownV2(chunk), { parse_mode: "MarkdownV2" });
  } catch (error) {
    const isParseError =
      error instanceof Error &&
      error.message.includes("can't parse entities");

    if (isParseError) {
      await telegram.sendMessage(chatId, chunk);
    } else {
      throw error;
    }
  }
};

export class TelegramAdapter implements ITelegramAdapter {
  private readonly bot: Telegraf<Context>;
  private readonly allowedTelegramUserId: string;

  constructor(
    private readonly app: ReturnType<typeof createWorkflowGraph>,
    config: AppConfig,
    private readonly fileSender?: IFileSender,
  ) {
    this.bot = new Telegraf(config.telegramBotToken);
    this.allowedTelegramUserId = config.allowedTelegramUserId;
  }

  async parseInbound(ctx: Context): Promise<HumanMessage | null> {
    if (ctx.from?.id.toString() !== this.allowedTelegramUserId) {
      console.warn(`Unauthorized access attempt from Telegram ID: ${ctx.from?.id}`);
      return null;
    }

    if (ctx.message && "text" in ctx.message) {
      logTelegramMessage("user", ctx.message.text);

      return new HumanMessage(ctx.message.text);
    }

    if (
      ctx.message &&
      "photo" in ctx.message &&
      Array.isArray(ctx.message.photo) &&
      ctx.message.photo.length > 0
    ) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      if (!photo) {
        return null;
      }

      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const caption = "caption" in ctx.message ? ctx.message.caption : undefined;

      logTelegramMessage("user", caption ?? "Process this image.");

      return new HumanMessage({
        content: [
          {
            type: "text",
            text: caption ?? "Process this image.",
          },
          {
            type: "image_url",
            image_url: { url: fileLink.href },
          },
        ],
      });
    }

    return null;
  }

  async triggerWorkflow(message: HumanMessage, threadId: string): Promise<AgentState> {
    return this.app.invoke(
      { messages: [message] },
      { configurable: { thread_id: threadId } },
    );
  }

  async sendOutbound(ctx: Context, stateMessages: BaseMessage[]): Promise<void> {
    const lastMessage = stateMessages[stateMessages.length - 1];
    const chatId = ctx.chat?.id;

    if (!chatId) {
      console.error("Unable to determine chat ID for outbound message.");
      return;
    }

    if (!lastMessage) {
      await ctx.telegram.sendMessage(chatId, "System Error: No response was produced.");
      return;
    }

    const output = extractTelegramMessageText(lastMessage.content).trim();

    if (!output) {
      await ctx.telegram.sendMessage(chatId, "System Error: Empty response from agent.");
      return;
    }

    logTelegramMessage("bot", output);

    // Split message into chunks that fit within Telegram's 4096 character limit
    const chunks = splitMessage(output);
    for (const chunk of chunks) {
      await sendChunk(ctx.telegram, chatId, chunk);
    }
  }

  async launch(): Promise<void> {
    this.bot.on("message", async (ctx) => {
      const inboundMessage = await this.parseInbound(ctx);

      if (!inboundMessage) {
        return;
      }

      const threadId = ctx.chat?.id?.toString();

      if (!threadId) {
        console.error("Unable to determine Telegram chat ID for incoming message.");
        return;
      }

      const chatId = ctx.chat?.id;
      if (chatId) {
        this.fileSender?.setCurrentChatId(chatId);
      }

      try {
        await ctx.sendChatAction("typing");
        const finalState = await this.triggerWorkflow(inboundMessage, threadId);
        await this.sendOutbound(ctx, finalState.messages);
      } catch (error) {
        if (error instanceof GraphRecursionError) {
          console.error("Agent recursion limit reached:", error);
          await sendSystemError(ctx, "I got stuck in a loop on that request. Please try rephrasing or try again.");
        } else {
          console.error("Agent execution error:", error);
          await sendSystemError(ctx, "System Error: Unable to process request.");
        }
      }
    });

    await this.bot.launch();
  }
}