import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractTriggerUserText } from "../../skill-attachments.js";
import { isEmptyModelResponse } from "../../../core/execution/sub-agent-messages.js";
import { resolveRelativeDayRange } from "../../../utils/datetime.js";
import { resolveActiveSkillFromHistory } from "../../../tools/skill-history.js";
const SYNC_EXPENSES_SKILL = "sync-expenses";

const hasFulfilledToolCall = (messages: BaseMessage[], toolName: string): boolean => {
  const toolMessagesById = new Map<string, ToolMessage>();

  for (const message of messages) {
    if (message instanceof ToolMessage && message.tool_call_id) {
      toolMessagesById.set(message.tool_call_id, message);
    }
  }

  for (const message of messages) {
    if (!(message instanceof AIMessage)) {
      continue;
    }

    for (const call of message.tool_calls ?? []) {
      if (call.name === toolName && call.id && toolMessagesById.has(call.id)) {
        return true;
      }
    }
  }

  return false;
};

export const shouldContinueSyncExpensesStep1 = (messages: BaseMessage[]): boolean => {
  const activeSkill = resolveActiveSkillFromHistory(messages);

  if (activeSkill?.skillName !== SYNC_EXPENSES_SKILL) {
    return false;
  }

  const lastMessage = messages[messages.length - 1];

  if (!(lastMessage instanceof ToolMessage)) {
    return false;
  }

  if (hasFulfilledToolCall(messages, "get_categories") || hasFulfilledToolCall(messages, "fetch_wise_transactions")) {
    return false;
  }

  return true;
};

export const buildSyncExpensesStep1Response = (
  messages: BaseMessage[],
  now = new Date(),
): AIMessage => {
  const triggerText = extractTriggerUserText(messages) ?? "";
  const { since, until } = resolveRelativeDayRange(triggerText, now);
  const suffix = `${now.getTime()}`;

  return new AIMessage({
    content: "",
    tool_calls: [
      {
        name: "get_categories",
        args: {},
        id: `sync-categories-${suffix}`,
        type: "tool_call",
      },
      {
        name: "fetch_wise_transactions",
        args: { since, until },
        id: `sync-wise-${suffix}`,
        type: "tool_call",
      },
    ],
  });
};

export const recoverEmptySyncExpensesResponse = (
  response: AIMessage,
  messages: BaseMessage[],
  now = new Date(),
): AIMessage => {
  if (!isEmptyModelResponse(response) || !shouldContinueSyncExpensesStep1(messages)) {
    return response;
  }

  return buildSyncExpensesStep1Response(messages, now);
};
