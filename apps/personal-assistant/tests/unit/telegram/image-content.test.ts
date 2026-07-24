import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchImageAsDataUrl } from "../../../src/telegram/image-content.js";

describe("fetchImageAsDataUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts fetched bytes into a base64 data URL", async () => {
    const imageBytes = Buffer.from("fake-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    await expect(fetchImageAsDataUrl("https://example.com/receipt.jpg")).resolves.toBe(
      `data:image/jpeg;base64,${imageBytes.toString("base64")}`,
    );
  });

  it("falls back to the URL extension when content-type is missing", async () => {
    const imageBytes = Buffer.from("png-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(imageBytes, { status: 200 })),
    );

    await expect(fetchImageAsDataUrl("https://example.com/receipt.png")).resolves.toBe(
      `data:image/png;base64,${imageBytes.toString("base64")}`,
    );
  });

  it("throws when the fetch response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })),
    );

    await expect(fetchImageAsDataUrl("https://example.com/missing.jpg")).rejects.toThrow(
      "Failed to fetch image (404 Not Found)",
    );
  });

  it("throws when the response body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(), { status: 200 })),
    );

    await expect(fetchImageAsDataUrl("https://example.com/empty.jpg")).rejects.toThrow(
      "Failed to fetch image: empty response body",
    );
  });
});
