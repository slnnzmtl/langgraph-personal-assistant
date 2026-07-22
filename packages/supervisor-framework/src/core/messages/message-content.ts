import type { BaseMessage } from "@langchain/core/messages";

export const extractMessageTextContent = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") {
    return content.replaceAll("\\n", "\n");
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
      .join("\n")
      .replaceAll("\\n", "\n");
  }

  // Gemini empty candidates can arrive as undefined/null content. Treat those as
  // empty so empty-response retry/fallback logic can run; never invent placeholder text.
  if (content == null) {
    return "";
  }

  return JSON.stringify(content);
};
