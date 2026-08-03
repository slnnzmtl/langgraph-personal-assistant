import { AIMessage, HumanMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent, extractNonTextContentParts } from "../message-content.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";

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

export const getRuntimeAgentIdFromMessage = (message: BaseMessage): string | undefined => {
  const value = message.additional_kwargs?.[RUNTIME_AGENT_CONTEXT_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** Stamp a handoff AI reply so later prepare can keep only this agent's turns. */
export const tagRuntimeAgentMessage = (message: AIMessage, agentId: string): AIMessage => {
  message.additional_kwargs = {
    ...message.additional_kwargs,
    [RUNTIME_AGENT_CONTEXT_KEY]: agentId,
  };
  return message;
};

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

  const lastHuman = messages[lastHumanIndex]!;
  const lastHumanNonText = extractNonTextContentParts(lastHuman.content);
  let sourceNonTextIndex = -1;
  let movedParts = lastHumanNonText;

  if (lastHumanNonText.length === 0) {
    for (let index = lastHumanIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !isHumanMessage(message)) {
        continue;
      }

      const parts = extractNonTextContentParts(message.content);
      if (parts.length > 0) {
        sourceNonTextIndex = index;
        movedParts = parts;
        break;
      }
    }
  }

  return messages.map((message, index) => {
    if (!isHumanMessage(message)) {
      return message;
    }

    if (index === lastHumanIndex) {
      if (movedParts.length === 0 || lastHumanNonText.length > 0) {
        return message;
      }

      const text = extractMessageTextContent(message.content).trim();
      return new HumanMessage([{ type: "text", text }, ...movedParts]);
    }

    if (index === sourceNonTextIndex || extractNonTextContentParts(message.content).length > 0) {
      return new HumanMessage(extractMessageTextContent(message.content).trim());
    }

    return message;
  });
};

/**
 * Keep only turns owned by this runtime agent: (human → tagged AI) pairs plus the
 * trailing human for the current delegation. Then collapse consecutive AI and
 * window to the last N human turns.
 *
 * Filter runs before collapse so a tagged handoff is not replaced by an untagged
 * supervisor FINISH duplicate.
 */
export const scopeSubAgentMessages = (
  messages: BaseMessage[],
  agentId: string,
  humanTurns = SUB_AGENT_CONTEXT_HUMAN_TURNS,
): BaseMessage[] => {
  const owned: BaseMessage[] = [];
  let pendingHuman: BaseMessage | undefined;

  for (const message of messages) {
    if (isHumanMessage(message)) {
      pendingHuman = message;
      continue;
    }

    if (isAiMessage(message) && getRuntimeAgentIdFromMessage(message) === agentId) {
      if (pendingHuman) {
        owned.push(pendingHuman);
        pendingHuman = undefined;
      }
      owned.push(message);
      continue;
    }

    if (isAiMessage(message)) {
      // Foreign or untagged AI — drop the human that belonged to that turn.
      pendingHuman = undefined;
    }
  }

  if (pendingHuman) {
    owned.push(pendingHuman);
  }

  const humanIndexes: number[] = [];

  for (let index = 0; index < owned.length; index += 1) {
    const message = owned[index];
    if (message && isHumanMessage(message)) {
      humanIndexes.push(index);
    }
  }

  const recent = humanIndexes.length === 0
    ? owned
    : stripStaleNonTextFromOlderHumans(
      owned.slice(
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
