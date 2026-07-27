const stripNullishFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripNullishFields);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)
        .map(([key, fieldValue]) => [key, stripNullishFields(fieldValue)]),
    );
  }

  return value;
};

export const minimizeJsonString = (value: unknown): string => {
  const minimized = stripNullishFields(value);

  if (Array.isArray(minimized)) {
    return minimized.map((item) => JSON.stringify(item)).join("\n");
  }

  return JSON.stringify(minimized);
};

export const serializeToolResult = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return typeof value === "string" ? value : JSON.stringify(value);
};
