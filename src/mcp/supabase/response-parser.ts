type TextContent = {
  type: string;
  text?: string;
};

export function parseExecuteSqlResponse(response: unknown): unknown {
  const content = (response as { content?: TextContent[] }).content;
  const text = content?.find((item) => item.type === "text")?.text;

  if (!text) {
    throw new Error("Unexpected response format from execute_sql tool");
  }

  try {
    return JSON.parse(text.trim());
  } catch {
    throw new Error("execute_sql response was not valid JSON");
  }
}
