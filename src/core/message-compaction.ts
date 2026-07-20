import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import {
  EMPTY_SUBAGENT_HANDOFF_KEY,
  getEmptySubAgentHandoff,
} from "./execution/empty-subagent-handoff.js";
import { extractMessageTextContent } from "../utils/message-content.js";

export const CONSUMED_TOOL_MARKER_PREFIX = "[consumed:";

export const formatConsumedToolMarker = (toolName: string): string =>
  `[consumed: ${toolName}]`;

export const formatConsumedHandoffMarker = (agentName: string): string =>
  `[consumed: ${agentName} tool results]`;

export const isConsumedToolMarker = (content: string): boolean =>
  content.trim().startsWith(CONSUMED_TOOL_MARKER_PREFIX);

const getToolBatchEndIndex = (messages: BaseMessage[], toolCallIndex: number): number => {
  const aiMessage = messages[toolCallIndex];
  if (!(aiMessage instanceof AIMessage) || !aiMessage.tool_calls?.length) {
    return toolCallIndex;
  }

  const toolCallIds = new Set(aiMessage.tool_calls.map((toolCall) => toolCall.id));
  let batchEnd = toolCallIndex;

  for (let index = toolCallIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message instanceof ToolMessage && toolCallIds.has(message.tool_call_id)) {
      batchEnd = index;
      continue;
    }

    break;
  }

  return batchEnd;
};

const collectConsumedToolIndexes = (messages: BaseMessage[]): Set<number> => {
  const consumedIndexes = new Set<number>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!(message instanceof AIMessage) || !message.tool_calls?.length) {
      continue;
    }

    const batchEnd = getToolBatchEndIndex(messages, index);
    if (batchEnd <= index || batchEnd >= messages.length - 1) {
      continue;
    }

    for (let toolIndex = index + 1; toolIndex <= batchEnd; toolIndex += 1) {
      if (messages[toolIndex] instanceof ToolMessage) {
        consumedIndexes.add(toolIndex);
      }
    }
  }

  return consumedIndexes;
};

export const compactConsumedToolResults = (messages: BaseMessage[]): BaseMessage[] => {
  const consumedIndexes = collectConsumedToolIndexes(messages);

  if (consumedIndexes.size === 0) {
    return messages;
  }

  return messages.map((message, index) => {
    if (!consumedIndexes.has(index) || !(message instanceof ToolMessage)) {
      return message;
    }

    const existingContent = extractMessageTextContent(message.content).trim();
    if (isConsumedToolMarker(existingContent)) {
      return message;
    }

    const toolName = message.name?.trim() || "tool";
    return new ToolMessage({
      tool_call_id: message.tool_call_id,
      ...(message.name ? { name: message.name } : {}),
      content: formatConsumedToolMarker(toolName),
    });
  });
};

const isResolvedSupervisorReply = (message: BaseMessage | undefined): boolean => {
  if (!(message instanceof AIMessage)) {
    return false;
  }

  if (getEmptySubAgentHandoff(message)) {
    return false;
  }

  const responseText = extractMessageTextContent(message.content).trim();
  const toolCalls = message.tool_calls ?? [];

  return responseText.length > 0 && toolCalls.length === 0;
};

export const compactEmptySubAgentHandoffs = (messages: BaseMessage[]): BaseMessage[] => {
  if (!isResolvedSupervisorReply(messages[messages.length - 1])) {
    return messages;
  }

  return messages.map((message) => {
    const handoff = getEmptySubAgentHandoff(message);
    if (!handoff || handoff.toolContext.trim().length === 0) {
      return message;
    }

    if (isConsumedToolMarker(handoff.toolContext)) {
      return message;
    }

    return new AIMessage({
      content: "",
      additional_kwargs: {
        [EMPTY_SUBAGENT_HANDOFF_KEY]: true,
        agentName: handoff.agentName,
        toolContext: formatConsumedHandoffMarker(handoff.agentName),
      },
    });
  });
};

export const compactIntermediateToolHistory = (messages: BaseMessage[]): BaseMessage[] =>
  compactEmptySubAgentHandoffs(compactConsumedToolResults(messages));
