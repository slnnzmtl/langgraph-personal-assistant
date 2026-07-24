import { HumanMessage } from "@langchain/core/messages";
import type { Context } from "telegraf";

export const CAPTIONLESS_PHOTO_TEXT =
  "Continue the previous vault edit with this image. Do not create a new note unless the user explicitly asked for one.";

export const DEFAULT_MEDIA_GROUP_DEBOUNCE_MS = 700;

export type MediaGroupMember = {
  imageDataUrl: string;
  caption?: string;
};

export type MediaGroupFlushHandler = (ctx: Context, message: HumanMessage) => Promise<void>;

type MediaGroupEntry = {
  members: MediaGroupMember[];
  caption?: string;
  ctx: Context;
  timer?: ReturnType<typeof setTimeout>;
};

export const buildMediaGroupBufferKey = (chatId: number, mediaGroupId: string): string =>
  `${chatId}:${mediaGroupId}`;

export const buildRapidPhotoBufferKey = (chatId: number): string =>
  `chat:${chatId}:rapid`;

export const resolvePhotoBufferKey = (chatId: number, mediaGroupId?: string): string =>
  mediaGroupId ? buildMediaGroupBufferKey(chatId, mediaGroupId) : buildRapidPhotoBufferKey(chatId);

export const buildMultimodalPhotoMessage = (
  text: string,
  imageDataUrls: string[],
): HumanMessage =>
  new HumanMessage({
    content: [
      { type: "text", text },
      ...imageDataUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ],
  });

export class MediaGroupBuffer {
  private readonly buffers = new Map<string, MediaGroupEntry>();

  constructor(
    private readonly debounceMs: number,
    private readonly onFlush: MediaGroupFlushHandler,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
  ) {}

  async add(ctx: Context, member: MediaGroupMember, mediaGroupId?: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    const key = resolvePhotoBufferKey(chatId, mediaGroupId);
    let entry = this.buffers.get(key);

    if (!entry) {
      entry = { members: [], ctx };
      this.buffers.set(key, entry);
    }

    entry.members.push(member);
    if (member.caption?.trim()) {
      entry.caption = member.caption.trim();
    }
    entry.ctx = ctx;

    if (entry.timer) {
      this.cancel(entry.timer);
    }

    entry.timer = this.schedule(() => {
      void this.flush(key);
    }, this.debounceMs);
  }

  async flush(key: string): Promise<void> {
    const entry = this.buffers.get(key);
    if (!entry || entry.members.length === 0) {
      return;
    }

    this.buffers.delete(key);

    if (entry.timer) {
      this.cancel(entry.timer);
    }

    const text = entry.caption ?? CAPTIONLESS_PHOTO_TEXT;
    const imageDataUrls = entry.members.map((member) => member.imageDataUrl);
    const message = buildMultimodalPhotoMessage(text, imageDataUrls);

    await this.onFlush(entry.ctx, message);
  }
}
