const UNTRUSTED_DATA_BLOCK_PATTERN =
  /(?:^|\n)<(untrusted-data-[^>]+)>\n([\s\S]*?)\n<\/\1>(?:\n|$)/m;

const tryParseJson = (input: string): unknown | undefined => {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
};

const extractJsonPayload = (input: string): string | undefined => {
  const untrustedBlock = input.match(UNTRUSTED_DATA_BLOCK_PATTERN)?.[2]?.trim();
  if (untrustedBlock) {
    return untrustedBlock;
  }

  const trimmed = input.trim();
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  return undefined;
};

export const normalizeToolOutput = (value: unknown, depth = 0): unknown => {
  if (depth > 4) {
    return value;
  }

  if (typeof value === "string") {
    const parsedDirectly = tryParseJson(value.trim());
    if (parsedDirectly !== undefined) {
      return normalizeToolOutput(parsedDirectly, depth + 1);
    }

    const jsonPayload = extractJsonPayload(value);
    if (jsonPayload) {
      const parsedPayload = tryParseJson(jsonPayload);
      if (parsedPayload !== undefined) {
        return normalizeToolOutput(parsedPayload, depth + 1);
      }
      return jsonPayload;
    }

    return value.trim();
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.result === "string") {
      return normalizeToolOutput(record.result, depth + 1);
    }

    if (Array.isArray(record.rows)) {
      return record.rows;
    }

    return value;
  }

  return value;
};


export const serializeToolResult = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return typeof value === "string" ? value : JSON.stringify(value);
};
