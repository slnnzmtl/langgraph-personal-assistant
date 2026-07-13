import { normalizeToolOutput } from "../../utils/exec-sql.js";

type TextContent = {
  type: string;
  text?: string;
};

export function formatRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: null`;
      if (typeof value === "string") return `${key}: '${value}'`;
      return `${key}: ${value}`;
    })
    .join(", ");
}

export function parseExecuteSqlResponse(response: unknown): unknown {
  const content = (response as { content?: TextContent[] }).content;
  const text = content?.find((item) => item.type === "text")?.text;

  if (!text) {
    throw new Error("Unexpected response format from execute_sql tool");
  }

  return normalizeToolOutput(text);
}
