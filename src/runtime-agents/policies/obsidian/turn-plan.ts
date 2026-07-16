import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../../../utils/message-content.js";

export type ObsidianTurnPlan = {
  allowedFunctionNames?: string[];
  nudgeMessage: string;
};

const MUTATION_INTENT_PATTERN =
  /\b(is done|are done|was done|done|completed|complete|finished|check(?:ed)? off|mark(?:ed)?|tick(?:ed)? off|unchecked todos?|add(?:ed)?|create(?:d)?|update(?:d)?|append(?:ed)?|delete(?:d)?|remove(?:d)?|move(?:d)?|write)\b/i;

export const sliceSinceLastHuman = (messages: BaseMessage[]): BaseMessage[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?._getType() === "human") {
      return messages.slice(index + 1);
    }
  }

  return messages;
};

export const getLastHumanText = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return extractMessageTextContent(message.content).trim();
    }
  }

  return "";
};

export const isMutationLikeUserMessage = (text: string): boolean =>
  MUTATION_INTENT_PATTERN.test(text.trim());

export const hasVaultMutationSuccessSinceLastHuman = (messages: BaseMessage[]): boolean =>
  sliceSinceLastHuman(messages).some((message) => {
    if (!(message instanceof ToolMessage)) {
      return false;
    }

    const content = extractMessageTextContent(message.content).trim();
    return content.startsWith("Success:");
  });

export const resolveObsidianPendingWritePlan = (
  messages: BaseMessage[],
): ObsidianTurnPlan | undefined => {
  const turnTools = sliceSinceLastHuman(messages).filter(
    (message): message is ToolMessage => message instanceof ToolMessage,
  );
  const lastTool = turnTools.at(-1);

  if (lastTool?.name !== "read_file") {
    return undefined;
  }

  if (turnTools.some((message) => message.name === "write_file")) {
    return undefined;
  }

  if (hasVaultMutationSuccessSinceLastHuman(messages)) {
    return undefined;
  }

  return {
    allowedFunctionNames: ["write_file"],
    nudgeMessage:
      "Do not reply in chat. Call write_file now with the full updated file content based on the read_file result above.",
  };
};

export const resolveObsidianMutationToolPlan = (
  messages: BaseMessage[],
): ObsidianTurnPlan | undefined => {
  const lastHumanText = getLastHumanText(messages);
  const turnTools = sliceSinceLastHuman(messages).filter(
    (message): message is ToolMessage => message instanceof ToolMessage,
  );

  if (turnTools.length > 0 || !isMutationLikeUserMessage(lastHumanText)) {
    return undefined;
  }

  return {
    nudgeMessage:
      "Do not confirm in chat. Vault edits require tools. For task updates: read_file first, then write_file with the updated content. Call the required tool(s) now.",
  };
};

export const resolveObsidianRetryPlan = (
  messages: BaseMessage[],
  responseText: string,
): ObsidianTurnPlan | undefined => {
  if (responseText.length === 0) {
    return undefined;
  }

  if (hasVaultMutationSuccessSinceLastHuman(messages)) {
    return undefined;
  }

  return resolveObsidianPendingWritePlan(messages)
    ?? resolveObsidianMutationToolPlan(messages);
};

export const obsidianTurnPlanBindOptions = (plan: ObsidianTurnPlan) => ({
  tool_choice: "any" as const,
  ...(plan.allowedFunctionNames ? { allowedFunctionNames: plan.allowedFunctionNames } : {}),
});
