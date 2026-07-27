import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../message-content.js";

export type ActiveSkillSelection = {
  skillName: string;
  args: Record<string, unknown>;
};

const isSuccessfulReadSkillResult = (toolMessage: ToolMessage): boolean => {
  const content = extractMessageTextContent(toolMessage.content).trim();
  return content.length > 0 && !content.startsWith("Error");
};

export const resolveActiveSkillFromHistory = (
  messages: BaseMessage[],
): ActiveSkillSelection | undefined => {
  const toolMessagesById = new Map<string, ToolMessage>();

  for (const message of messages) {
    if (message instanceof ToolMessage && message.tool_call_id) {
      toolMessagesById.set(message.tool_call_id, message);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof AIMessage)) {
      continue;
    }

    for (const call of message.tool_calls ?? []) {
      if (call.name !== "read_skill") {
        continue;
      }

      const response = call.id ? toolMessagesById.get(call.id) : undefined;
      if (!response || !isSuccessfulReadSkillResult(response)) {
        continue;
      }

      const args = (call.args ?? {}) as Record<string, unknown>;
      const skillName = typeof args.name === "string" ? args.name.trim().toLowerCase() : undefined;
      if (!skillName) {
        continue;
      }

      return { skillName, args };
    }
  }

  return undefined;
};
