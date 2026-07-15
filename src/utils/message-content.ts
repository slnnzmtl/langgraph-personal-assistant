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

  return content ? JSON.stringify(content) : "[Action completed via internal tool]";
};
