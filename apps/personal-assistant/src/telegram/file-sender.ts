import type { Telegram } from "telegraf";

import type { IFileSender } from "../ports/file-sender.js";

export type { IFileSender } from "../ports/file-sender.js";

export class TelegramFileSender implements IFileSender {
  private currentChatId: number | null = null;

  constructor(private readonly telegram: Telegram) {}

  setCurrentChatId(chatId: number): void {
    this.currentChatId = chatId;
  }

  async sendFile(absolutePath: string): Promise<void> {
    if (this.currentChatId === null) {
      throw new Error("Chat ID not set. Cannot send file without a target chat.");
    }

    const fs = await import("fs");
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${absolutePath}`);
    }

    await this.telegram.sendDocument(this.currentChatId, {
      source: absolutePath,
    });
  }
}
