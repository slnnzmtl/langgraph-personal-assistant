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

const defaultInvokeResult = {
  messages: [new AIMessage("handled")],
  context: {},
  next: "FINISH" as const,
};

const app = {
  invoke: vi.fn(async () => defaultInvokeResult),
};

const bot = {
  on: vi.fn(),
  launch: vi.fn(async () => undefined),
  telegram: {},
} as unknown as Telegraf<Context>;

const createAdapter = () => new TelegramAdapter(app as never, config, bot);

afterEach(() => {
  vi.restoreAllMocks();
  app.invoke.mockReset();
  app.invoke.mockImplementation(async () => defaultInvokeResult);
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
    const imageBytes = Buffer.from("fake-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    const textMessage = await adapter.parseInbound({
      from: { id: 42 },
      message: { text: "hello" },
    } as never);

    expect(textMessage).toBeInstanceOf(HumanMessage);
    expect(textMessage?.content).toBe("hello");

    const photoMessage = await adapter.parseInbound({
      from: { id: 42 },
      chat: { id: 42 },
      message: {
        photo: [{ file_id: "file-1" }],
        caption: "receipt",
      },
      telegram: {
        getFileLink: vi.fn(async () => new URL("https://example.com/receipt.jpg")),
      },
    } as never);

    expect(photoMessage).toBe("media-group-buffered");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("user: hello");
  });

  it("buffers captionless single photos until debounce flush", async () => {
    const adapter = createAdapter();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const imageBytes = Buffer.from("fake-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    const photoMessage = await adapter.parseInbound({
      from: { id: 42 },
      chat: { id: 42 },
      message: {
        photo: [{ file_id: "file-1" }],
      },
      telegram: {
        getFileLink: vi.fn(async () => new URL("https://example.com/receipt.jpg")),
      },
    } as never);

    expect(photoMessage).toBe("media-group-buffered");
  });

  it("buffers media group photos instead of returning an immediate message", async () => {
    const adapter = createAdapter();
    const imageBytes = Buffer.from("fake-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    const result = await adapter.parseInbound({
      from: { id: 42 },
      chat: { id: 42 },
      message: {
        photo: [{ file_id: "file-1" }],
        media_group_id: "album-1",
      },
      telegram: {
        getFileLink: vi.fn(async () => new URL("https://example.com/receipt.jpg")),
      },
    } as never);

    expect(result).toBe("media-group-buffered");
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

  it("skips duplicate Telegram update ids", async () => {
    const adapter = createAdapter();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    const ctx = {
      update: { update_id: 1001 },
      from: { id: 42 },
      chat: { id: 555 },
      message: { text: "hello" },
      sendChatAction,
      telegram: { sendMessage: vi.fn(async () => undefined) },
    };

    await adapter.handleMessage(ctx as never);
    await adapter.handleMessage(ctx as never);

    expect(app.invoke).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Skipping duplicate Telegram update: 1001");
  });

  it("serializes concurrent workflow invokes for the same chat", async () => {
    const adapter = createAdapter();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedGate = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    app.invoke.mockImplementationOnce(async () => {
      order.push("first-start");
      firstStarted();
      await firstGate;
      order.push("first-end");
      return { messages: [new AIMessage("first")], context: {}, next: "FINISH" as const };
    });
    app.invoke.mockImplementationOnce(async () => {
      order.push("second-start");
      order.push("second-end");
      return { messages: [new AIMessage("second")], context: {}, next: "FINISH" as const };
    });

    const sendMessage = vi.fn(async () => undefined);
    const baseCtx = {
      from: { id: 42 },
      chat: { id: 555 },
      sendChatAction: vi.fn(async () => undefined),
      telegram: { sendMessage },
    };

    const first = adapter.handleMessage({
      ...baseCtx,
      update: { update_id: 2001 },
      message: { text: "one" },
    } as never);
    const second = adapter.handleMessage({
      ...baseCtx,
      update: { update_id: 2002 },
      message: { text: "two" },
    } as never);

    await firstStartedGate;
    expect(order).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    expect(app.invoke).toHaveBeenCalledTimes(2);
  });

  it("calls setCurrentChatId on the fileSender before triggering the workflow", async () => {
    const mockFileSender = {
      setCurrentChatId: vi.fn(),
      sendFile: vi.fn(async () => undefined),
    };
    const adapter = new TelegramAdapter(app as never, config, bot, mockFileSender);
    const sendMessage = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await adapter.handleMessage({
      update: { update_id: 3001 },
      from: { id: 42 },
      chat: { id: 555 },
      message: { text: "send me a file" },
      sendChatAction: vi.fn(async () => undefined),
      telegram: { sendMessage },
    } as never);

    expect(mockFileSender.setCurrentChatId).toHaveBeenCalledWith(555);
    expect(app.invoke).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});