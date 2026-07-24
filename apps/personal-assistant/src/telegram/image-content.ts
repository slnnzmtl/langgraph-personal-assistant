const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const resolveMimeType = (sourceUrl: string, contentType: string | null): string => {
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedContentType?.startsWith("image/")) {
    return normalizedContentType;
  }

  const extension = sourceUrl.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  if (extension && MIME_BY_EXTENSION[extension]) {
    return MIME_BY_EXTENSION[extension]!;
  }

  return "image/jpeg";
};

export const fetchImageAsDataUrl = async (sourceUrl: string): Promise<string> => {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status} ${response.statusText})`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Failed to fetch image: empty response body");
  }

  const mimeType = resolveMimeType(sourceUrl, response.headers.get("content-type"));
  const base64 = Buffer.from(bytes).toString("base64");

  return `data:${mimeType};base64,${base64}`;
};
