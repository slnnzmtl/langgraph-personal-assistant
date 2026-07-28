import { AIMessage, HumanMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";

export const TOOL_RESULT_RECOVERY_DIRECTIVE = [
  "Your previous response was empty after a tool result.",
  "Inspect the latest tool message in history:",
  "- If it contains a recoverable error (e.g. SQL syntax, ambiguous column), fix the smallest faulty tool call and retry.",
  "- If the workflow requires verification after a write, complete verification before confirming to the user.",
  "- If you cannot recover, reply in plain text with a brief status. Do not stop silently.",
  "- A tool error is not a user-facing completion. Never claim a write succeeded unless a successful tool payload proves it.",
].join("\n");

import { extractMessageTextContent, extractNonTextContentParts } from "../message-content.js";

/** How many recent human turns (with intervening assistant replies) to keep for sub-agents. */
export const SUB_AGENT_CONTEXT_HUMAN_TURNS = 3;

const isHumanMessage = (message: BaseMessage): boolean =>
  message instanceof HumanMessage || message._getType() === "human";

export const stripStaleNonTextFromOlderHumans = (messages: BaseMessage[]): BaseMessage[] => {
  let lastHumanIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isHumanMessage(message)) {
      lastHumanIndex = index;
      break;
    }
  }

  if (lastHumanIndex === -1) {
    return messages;
  }

  return messages.map((message, index) => {
    if (!isHumanMessage(message) || index === lastHumanIndex) {
      return message;
    }

    const text = extractMessageTextContent(message.content).trim();
    return text.length > 0 ? new HumanMessage(text) : message;
  });
};

/**
 * Keep recent conversational context for the runtime agent: the last N human
 * turns plus any assistant messages between/after them. This preserves
 * clarification follow-ups without sending the full thread.
 */
export const scopeSubAgentMessages = (
  messages: BaseMessage[],
  humanTurns = SUB_AGENT_CONTEXT_HUMAN_TURNS,
): BaseMessage[] => {
  const humanIndexes: number[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && isHumanMessage(message)) {
      humanIndexes.push(index);
    }
  }

  if (humanIndexes.length === 0) {
    return messages;
  }

  const startIndex = humanIndexes[Math.max(0, humanIndexes.length - Math.max(1, humanTurns))]!;
  return stripStaleNonTextFromOlderHumans(messages.slice(startIndex));
};

/**
 * When the supervisor delegates, pass only the delegation prompt (plus any
 * multimodal parts from the latest human turn) instead of the full thread.
 */
export const scopeDelegatedSubAgentMessages = (
  parentMessages: BaseMessage[],
  delegationPrompt: string,
): BaseMessage[] => {
  const trimmed = delegationPrompt.trim();
  if (trimmed.length === 0) {
    return [];
  }

  let lastHuman: BaseMessage | undefined;

  for (let index = parentMessages.length - 1; index >= 0; index -= 1) {
    const message = parentMessages[index];
    if (message && isHumanMessage(message)) {
      lastHuman = message;
      break;
    }
  }

  const preservedParts = lastHuman
    ? extractNonTextContentParts(lastHuman.content)
    : [];

  if (preservedParts.length === 0) {
    return [new HumanMessage(trimmed)];
  }

  return [new HumanMessage([
    { type: "text", text: trimmed },
    ...preservedParts,
  ])];
};

export const applyDelegationPrompt = (
  messages: BaseMessage[],
  prompt: string,
): BaseMessage[] => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return messages;
  }

  let lastHumanIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isHumanMessage(message)) {
      lastHumanIndex = index;
      break;
    }
  }

  if (lastHumanIndex === -1) {
    return [new HumanMessage(trimmed), ...messages];
  }

  const previousHumanMessage = messages[lastHumanIndex];
  const preservedParts = previousHumanMessage
    ? extractNonTextContentParts(previousHumanMessage.content)
    : [];
  const nextMessages = [...messages];
  nextMessages[lastHumanIndex] = preservedParts.length > 0
    ? new HumanMessage([
      { type: "text", text: trimmed },
      ...preservedParts,
    ])
    : new HumanMessage(trimmed);
  return nextMessages;
};

export const buildRuntimeAgentPromptMessages = (
  systemInstructions: BaseMessage,
  stateMessages: BaseMessage[],
): BaseMessage[] => {
  const conversation = [systemInstructions, ...stateMessages];
  const hasToolMessages = stateMessages.some((message) => message._getType() === "tool");

  return hasToolMessages ? conversation : mergeMessageRuns(conversation);
};

export const isEmptyModelResponse = (response: AIMessage): boolean => {
  const responseText = extractMessageTextContent(response.content).trim();
  const toolCalls = response.tool_calls ?? [];

  return responseText.length === 0 && toolCalls.length === 0;
};

export const buildRecoveryPromptMessages = (
  promptMessages: BaseMessage[],
): BaseMessage[] => [
  ...promptMessages,
  new HumanMessage(TOOL_RESULT_RECOVERY_DIRECTIVE),
];
