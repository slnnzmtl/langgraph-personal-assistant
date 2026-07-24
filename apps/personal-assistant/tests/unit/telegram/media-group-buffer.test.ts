import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAPTIONLESS_PHOTO_TEXT,
  MediaGroupBuffer,
  buildMediaGroupBufferKey,
  buildMultimodalPhotoMessage,
  buildRapidPhotoBufferKey,
  resolvePhotoBufferKey,
} from "../../../src/telegram/media-group-buffer.js";

describe("resolvePhotoBufferKey", () => {
  it("uses the media group key when an album id is present", () => {
    expect(resolvePhotoBufferKey(42, "album-1")).toBe("42:album-1");
  });

  it("uses the rapid chat key for single photos", () => {
    expect(resolvePhotoBufferKey(42)).toBe("chat:42:rapid");
  });
});

describe("buildMediaGroupBufferKey", () => {
  it("combines chat id and media group id", () => {
    expect(buildMediaGroupBufferKey(42, "album-1")).toBe("42:album-1");
  });
});

describe("buildRapidPhotoBufferKey", () => {
  it("scopes rapid singles to the chat", () => {
    expect(buildRapidPhotoBufferKey(42)).toBe("chat:42:rapid");
  });
});

describe("buildMultimodalPhotoMessage", () => {
  it("builds one text part and one image part per url", () => {
    const message = buildMultimodalPhotoMessage("caption", [
      "data:image/jpeg;base64,one",
      "data:image/jpeg;base64,two",
    ]);

    expect(message.content).toEqual([
      { type: "text", text: "caption" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,one" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,two" } },
    ]);
  });
});

describe("MediaGroupBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes album members into one multimodal message after debounce", async () => {
    vi.useFakeTimers();

    const onFlush = vi.fn(async () => undefined);
    const buffer = new MediaGroupBuffer(700, onFlush);
    const ctx = { chat: { id: 42 } } as never;

    await buffer.add(ctx, { imageDataUrl: "data:image/jpeg;base64,one" }, "album-1");
    await buffer.add(ctx, { imageDataUrl: "data:image/jpeg;base64,two", caption: "receipt" }, "album-1");

    expect(onFlush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const flushedMessage = onFlush.mock.calls[0]?.[1] as HumanMessage;
    expect(flushedMessage.content).toEqual([
      { type: "text", text: "receipt" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,one" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,two" } },
    ]);
  });

  it("coalesces rapid singles in the same chat before flush", async () => {
    vi.useFakeTimers();

    const onFlush = vi.fn(async () => undefined);
    const buffer = new MediaGroupBuffer(700, onFlush);
    const ctx = { chat: { id: 42 } } as never;

    await buffer.add(ctx, { imageDataUrl: "data:image/jpeg;base64,one" });
    await buffer.add(ctx, { imageDataUrl: "data:image/jpeg;base64,two", caption: "Parse screenshots" });

    await vi.advanceTimersByTimeAsync(700);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const flushedMessage = onFlush.mock.calls[0]?.[1] as HumanMessage;
    expect(flushedMessage.content).toEqual([
      { type: "text", text: "Parse screenshots" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,one" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,two" } },
    ]);
  });

  it("uses continuation text when no album caption exists", async () => {
    const onFlush = vi.fn(async () => undefined);
    const buffer = new MediaGroupBuffer(700, onFlush);
    const ctx = { chat: { id: 42 } } as never;
    const key = buildMediaGroupBufferKey(42, "album-2");

    await buffer.add(ctx, { imageDataUrl: "data:image/jpeg;base64,one" }, "album-2");
    await buffer.flush(key);

    const flushedMessage = onFlush.mock.calls[0]?.[1] as HumanMessage;
    expect(flushedMessage.content).toEqual([
      { type: "text", text: CAPTIONLESS_PHOTO_TEXT },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,one" } },
    ]);
  });
});
