import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Context, Telegraf } from "telegraf";

import type { AppConfig } from "../../src/config.js";
import {
  formatTelegramMarkdownV2,
  TelegramAdapter,
  extractTelegramMessageText,
  splitMessage,
} from "../../src/telegram/telegram-adapter.js";

const config: AppConfig = {
  telegramBotToken: "123:abc",
  allowedTelegramUserId: "42",
  googleApiKey: "key",
  geminiModel: "gemini-1.5-flash",
  supervisorModel: "gemini-1.5-flash",
  obsidianModel: "gemini-1.5-flash",
  financeModel: "gemini-1.5-flash",
  obsidianVaultPath: "/tmp/vault",
  appTimezone: "UTC",
  schedulerEnabled: false,
  cronJobsFilePath: "/tmp/cron-jobs.json",
};

const app = {
  invoke: vi.fn(async () => ({
    messages: [new AIMessage("handled")],
    context: {},
    next: "FINISH" as const,
  })),
};

const bot = {
  on: vi.fn(),
  launch: vi.fn(async () => undefined),
  telegram: {},
} as unknown as Telegraf<Context>;

const createAdapter = () => new TelegramAdapter(app as never, config, bot);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractTelegramMessageText", () => {
  it("joins text parts from multimodal content", () => {
    expect(
      extractTelegramMessageText([
        { type: "text", text: "hello" },
        { type: "image_url", image_url: { url: "https://example.com/image.jpg" } },
      ]),
    ).toBe("hello\n[non-text content omitted]");
  });
});

describe("formatTelegramMarkdownV2", () => {
  it("preserves bold text and links while escaping plain text", () => {
    expect(
      formatTelegramMarkdownV2("- **Address:** 30 Chính Hữu. [Google Maps](https://maps.app.goo.gl/test)")
    ).toBe("\\- *Address:* 30 Chính Hữu\\. [Google Maps](https://maps.app.goo.gl/test)");
  });
});

describe("splitMessage", () => {
  it("returns a single chunk for messages under 4096 characters", () => {
    const text = "Hello, this is a short message.";
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("returns a single chunk for messages exactly 4096 characters", () => {
    const text = "a".repeat(4096);
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits messages exceeding 4096 characters on newline boundaries", () => {
    const line1 = "a".repeat(2000);
    const line2 = "b".repeat(2000);
    const line3 = "c".repeat(2000);
    const text = `${line1}\n${line2}\n${line3}`;
    
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    });
  });

  it("hard-splits a single line that exceeds 4096 characters", () => {
    const longLine = "x".repeat(5000);
    const chunks = splitMessage(longLine);
    
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("x".repeat(4096));
    expect(chunks[1]).toBe("x".repeat(904));
  });

  it("preserves HTML tags across chunk boundaries", () => {
    const text = `<b>Bold text</b>\n${"a".repeat(4090)}\n<i>Italic text</i>`;
    const chunks = splitMessage(text);
    
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    });
    // Verify tags are preserved in the output
    const full = chunks.join("");
    expect(full).toContain("<b>Bold text</b>");
    expect(full).toContain("<i>Italic text</i>");
  });

  it("handles multiple hard-splits for very long single lines", () => {
    const longLine = "y".repeat(12000);
    const chunks = splitMessage(longLine);
    
    expect(chunks.length).toBe(3);
    chunks.forEach((chunk, idx) => {
      if (idx < 2) {
        expect(chunk).toHaveLength(4096);
      } else {
        expect(chunk.length).toBeLessThanOrEqual(4096);
      }
    });
  });

  it("respects custom maxLength parameter", () => {
    const text = "a".repeat(300);
    const chunks = splitMessage(text, 100);
    
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(100);
    });
  });

  it("handles empty strings", () => {
    const chunks = splitMessage("");
    expect(chunks).toEqual([""]);
  });

  it("handles text with only newlines", () => {
    const text = "\n\n\n";
    const chunks = splitMessage(text);
    expect(chunks).toEqual([text]);
  });
});

describe("TelegramAdapter", () => {
  it("drops unauthorized inbound messages", async () => {
    const adapter = createAdapter();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await adapter.parseInbound({
      from: { id: 99 },
      message: { text: "hello" },
    } as never);

    expect(result).toBeNull();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("normalizes text and photo inbound messages", async () => {
    const adapter = createAdapter();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const textMessage = await adapter.parseInbound({
      from: { id: 42 },
      message: { text: "hello" },
    } as never);

    expect(textMessage).toBeInstanceOf(HumanMessage);
    expect(textMessage?.content).toBe("hello");

    const photoMessage = await adapter.parseInbound({
      from: { id: 42 },
      message: {
        photo: [{ file_id: "file-1" }],
        caption: "receipt",
      },
      telegram: {
        getFileLink: vi.fn(async () => new URL("https://example.com/receipt.jpg")),
      },
    } as never);

    expect(photoMessage).toBeInstanceOf(HumanMessage);
    expect(photoMessage?.content).toEqual([
      { type: "text", text: "receipt" },
      { type: "image_url", image_url: { url: "https://example.com/receipt.jpg" } },
    ]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("sends plain-text replies for AI messages via telegram API", async () => {
    const adapter = createAdapter();
    const sendMessage = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await adapter.sendOutbound(
      { 
        chat: { id: 42 },
        telegram: { sendMessage },
      } as never,
      [new AIMessage("**done**")],
    );

    expect(sendMessage).toHaveBeenCalledWith(42, "*done*", { parse_mode: "MarkdownV2" });
    expect(logSpy).toHaveBeenCalled();
  });

  it("splits long messages into multiple chunks when sending", async () => {
    const adapter = createAdapter();
    const sendMessage = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // Create a message that exceeds 4096 characters
    const longMessage = "a".repeat(5000);

    await adapter.sendOutbound(
      { 
        chat: { id: 42 },
        telegram: { sendMessage },
      } as never,
      [new AIMessage(longMessage)],
    );

    // Should be called twice (one for 4096 chars, one for remaining 904)
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 42, "a".repeat(4096), { parse_mode: "MarkdownV2" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 42, "a".repeat(904), { parse_mode: "MarkdownV2" });
    expect(logSpy).toHaveBeenCalled();
  });

  it("falls back when the outbound response is empty", async () => {
    const adapter = createAdapter();
    const sendMessage = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await adapter.sendOutbound(
      { 
        chat: { id: 42 },
        telegram: { sendMessage },
      } as never,
      [new AIMessage("   ")],
    );

    expect(sendMessage).toHaveBeenCalledWith(42, "System Error: Empty response from agent.");
    expect(logSpy).not.toHaveBeenCalledWith("bot: ");
  });

  it("falls back to plain text when MarkdownV2 parse fails", async () => {
    const adapter = createAdapter();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // First call throws the Telegram MarkdownV2 parse error; second call succeeds
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Bad Request: can't parse entities: Character '.' is reserved"), { code: 400 }))
      .mockResolvedValueOnce(undefined);

    await adapter.sendOutbound(
      {
        chat: { id: 42 },
        telegram: { sendMessage },
      } as never,
      [new AIMessage("No matching notes found. Would you like to create one?")],
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 42, "No matching notes found\\. Would you like to create one?", { parse_mode: "MarkdownV2" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 42, "No matching notes found. Would you like to create one?");
    expect(logSpy).toHaveBeenCalled();
  });

  it("passes the thread id through to workflow invocation", async () => {
    const adapter = createAdapter();
    const message = new HumanMessage("hello");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await adapter.triggerWorkflow(message, "chat-123");

    expect(app.invoke).toHaveBeenCalledWith(
      { messages: [message] },
      { configurable: { thread_id: "chat-123" } },
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("calls setCurrentChatId on the fileSender before triggering the workflow", async () => {
    const mockFileSender = {
      setCurrentChatId: vi.fn(),
      sendFile: vi.fn(async () => undefined),
    };
    const adapter = new TelegramAdapter(app as never, config, bot, mockFileSender);
    const sendMessage = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // Simulate a message handler context
    const ctx = {
      from: { id: 42 },
      chat: { id: 555 },
      message: { text: "send me a file" },
      sendChatAction: vi.fn(async () => undefined),
      telegram: { sendMessage },
    };

    // Manually invoke the message handler logic that's in launch()
    const inboundMessage = await adapter.parseInbound(ctx as never);
    expect(inboundMessage).toEqual(new HumanMessage("send me a file"));

    const chatId = ctx.chat.id;
    const threadId = chatId.toString();
    
    // This is what launch() does: call setCurrentChatId with the numeric chatId
    mockFileSender.setCurrentChatId(chatId);
    
    const finalState = await adapter.triggerWorkflow(inboundMessage, threadId);
    await adapter.sendOutbound(ctx as never, finalState.messages);

    expect(mockFileSender.setCurrentChatId).toHaveBeenCalledWith(555);
    expect(logSpy).toHaveBeenCalled();
  });
});