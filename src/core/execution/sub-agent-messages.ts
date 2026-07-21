import { AIMessage, HumanMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";

export const TOOL_RESULT_RECOVERY_DIRECTIVE = [
  "Your previous response was empty after a tool result.",
  "Inspect the latest tool message in history:",
  "- If it contains a recoverable error (e.g. SQL syntax, ambiguous column), fix the smallest faulty tool call and retry.",
  "- If the workflow requires verification after a write, complete verification before confirming to the user.",
  "- If you cannot recover, reply in plain text with a brief status. Do not stop silently.",
  "- A tool error is not a user-facing completion. Never claim a write succeeded unless a successful tool payload proves it.",
].join("\n");

import { extractMessageTextContent } from "../messages/message-content.js";

/** How many recent human turns (with intervening assistant replies) to keep for sub-agents. */
export const SUB_AGENT_CONTEXT_HUMAN_TURNS = 3;

const isHumanMessage = (message: BaseMessage): boolean =>
  message instanceof HumanMessage || message._getType() === "human";

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
  return messages.slice(startIndex);
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
