export const TOOL_OUTPUT_MAX_CHARS = 8_000;

export const truncateToolOutput = (
  output: string,
  maxChars = TOOL_OUTPUT_MAX_CHARS,
): string =>
  output.length <= maxChars
    ? output
    : `${output.slice(0, maxChars)}\u2026[truncated, ${output.length - maxChars} chars omitted]`;

export const serializeToolResult = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return typeof value === "string" ? value : JSON.stringify(value);
};
