import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../src/config.js";
import { TelegramAdapter, extractTelegramMessageText } from "../../src/telegram/telegram-adapter.js";

const config: AppConfig = {
  telegramBotToken: "123:abc",
  allowedTelegramUserId: "42",
  googleApiKey: "key",
  geminiModel: "gemini-1.5-flash",
  obsidianVaultPath: "/tmp/vault",
};

const app = {
  invoke: vi.fn(async () => ({
    messages: [new AIMessage("handled")],
    context: {},
    next: "FINISH" as const,
  })),
};

const createAdapter = () => new TelegramAdapter(app as never, config);

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

describe("TelegramAdapter", () => {
  it("drops unauthorized inbound messages", async () => {
    const adapter = createAdapter();

    const result = await adapter.parseInbound({
      from: { id: 99 },
      message: { text: "hello" },
    } as never);

    expect(result).toBeNull();
  });

  it("normalizes text and photo inbound messages", async () => {
    const adapter = createAdapter();

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
  });

  it("sends markdown replies for AI messages", async () => {
    const adapter = createAdapter();
    const reply = vi.fn(async () => undefined);

    await adapter.sendOutbound(
      { reply } as never,
      [new AIMessage("**done**")],
    );

    expect(reply).toHaveBeenCalledWith("**done**", { parse_mode: "Markdown" });
  });

  it("passes the thread id through to workflow invocation", async () => {
    const adapter = createAdapter();
    const message = new HumanMessage("hello");

    await adapter.triggerWorkflow(message, "chat-123");

    expect(app.invoke).toHaveBeenCalledWith(
      { messages: [message] },
      { configurable: { thread_id: "chat-123" } },
    );
  });
});