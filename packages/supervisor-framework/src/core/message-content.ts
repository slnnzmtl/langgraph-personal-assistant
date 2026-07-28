import type { BaseMessage } from "@langchain/core/messages";

type NonTextContentPart = Exclude<
  Extract<BaseMessage["content"], readonly unknown[]>[number],
  string | { type: "text"; text: string }
>;

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

export const extractNonTextContentParts = (
  content: BaseMessage["content"],
): NonTextContentPart[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((part): part is NonTextContentPart => {
    if (typeof part === "string") {
      return false;
    }

    return part.type !== "text";
  });
};
