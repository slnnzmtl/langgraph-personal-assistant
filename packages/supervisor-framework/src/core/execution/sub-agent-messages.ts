import { AIMessage, HumanMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent, extractNonTextContentParts } from "../message-content.js";

export const TOOL_RESULT_RECOVERY_DIRECTIVE = [
  "Your previous response was empty after a tool result.",
  "Inspect the latest tool message in history:",
  "- If it contains a recoverable error (e.g. SQL syntax, ambiguous column), fix the smallest faulty tool call and retry.",
  "- If the workflow requires verification after a write, complete verification before confirming to the user.",
  "- If you cannot recover, reply in plain text with a brief status. Do not stop silently.",
  "- A tool error is not a user-facing completion. Never claim a write succeeded unless a successful tool payload proves it.",
].join("\n");

export const EMPTY_FIRST_TURN_RECOVERY_DIRECTIVE = [
  "Your previous response was empty (no text and no tool calls).",
  "Continue without stopping silently: call read_skill(skill_name) or another bound tool if needed, otherwise reply in plain text.",
].join("\n");

/** How many recent human turns (with intervening assistant replies) to keep for sub-agents. */
export const SUB_AGENT_CONTEXT_HUMAN_TURNS = 3;

const isHumanMessage = (message: BaseMessage): boolean =>
  message instanceof HumanMessage || message._getType() === "human";

const isAiMessage = (message: BaseMessage): boolean =>
  message instanceof AIMessage || message._getType() === "ai";

/** Keep latest of consecutive AI turns (handoff + supervisor FINISH duplicates). */
const collapseConsecutiveAssistantMessages = (
  messages: BaseMessage[],
): BaseMessage[] => {
  const result: BaseMessage[] = [];

  for (const message of messages) {
    const last = result[result.length - 1];
    if (last && isAiMessage(last) && isAiMessage(message)) {
      result[result.length - 1] = message;
      continue;
    }
    result.push(message);
  }

  return result;
};

const stripStaleNonTextFromOlderHumans = (messages: BaseMessage[]): BaseMessage[] => {
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
 * Also collapses consecutive assistant turns (handoff then FINISH).
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

  const recent = humanIndexes.length === 0
    ? messages
    : stripStaleNonTextFromOlderHumans(
      messages.slice(
        humanIndexes[Math.max(0, humanIndexes.length - Math.max(1, humanTurns))]!,
      ),
    );

  return collapseConsecutiveAssistantMessages(recent);
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
  options: { isLoopContinuation?: boolean } = {},
): BaseMessage[] => [
  ...promptMessages,
  new HumanMessage(
    options.isLoopContinuation
      ? TOOL_RESULT_RECOVERY_DIRECTIVE
      : EMPTY_FIRST_TURN_RECOVERY_DIRECTIVE,
  ),
];
