import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { Telegraf } from "telegraf";
import type { Context } from "telegraf";

import type { AppConfig } from "../config.js";
import type { createWorkflowGraph } from "../graph/workflow-graph.js";
import type { AgentState } from "../state.js";

export interface ITelegramAdapter {
  parseInbound(ctx: Context): Promise<HumanMessage | null>;
  triggerWorkflow(message: HumanMessage, threadId: string): Promise<AgentState>;
  sendOutbound(ctx: Context, stateMessages: BaseMessage[]): Promise<void>;
  launch(): Promise<void>;
}

export const extractTelegramMessageText = (content: BaseMessage["content"]): string => {
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

        return "[non-text content omitted]";
      })
      .join("\n");
  }

  return JSON.stringify(content);
};

const truncateForLog = (value: string, maxLength = 500): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

const logTelegramMessage = (role: "user" | "bot", text: string): void => {
  console.log(`${role}: ${truncateForLog(text)}`);
};

export class TelegramAdapter implements ITelegramAdapter {
  private readonly bot: Telegraf<Context>;
  private readonly allowedTelegramUserId: string;

  constructor(
    private readonly app: ReturnType<typeof createWorkflowGraph>,
    config: AppConfig,
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

    if (!lastMessage) {
      await ctx.reply("System Error: No response was produced.");
      return;
    }

    const output = extractTelegramMessageText(lastMessage.content);

    logTelegramMessage("bot", output);

    if (lastMessage instanceof AIMessage) {
      await ctx.reply(output, { parse_mode: "Markdown" });
      return;
    }

    await ctx.reply(output);
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

      try {
        await ctx.sendChatAction("typing");
        const finalState = await this.triggerWorkflow(inboundMessage, threadId);
        await this.sendOutbound(ctx, finalState.messages);
      } catch (error) {
        console.error("Agent execution error:", error);
        await ctx.reply("System Error: Unable to process request.");
      }
    });

    await this.bot.launch();
  }
}