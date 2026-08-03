import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import type { AgentStateUpdate } from "../state.js";
import { extractMessageTextContent } from "../message-content.js";
import { hasCompletedAgentReply } from "./tool-completion-summary.js";
import type { SubAgentState } from "./sub-agent-state.js";

export type MapSubAgentResultOptions = {
  buildSummary?: (messages: BaseMessage[]) => string | undefined;
  completionFallback?: string;
  maxStepsMessage?: string | ((config: { maxSteps: number; name: string }) => string);
  isSuccessfulSideEffect?: (messages: BaseMessage[]) => boolean;
  /** When salvage is configured: empty handoff if nothing else matched. Default/finance omit this. */
  emptyHandoffWhenNoSalvage?: boolean;
};

export const createMaxStepsExceededUpdate = (
  name: string,
  maxSteps: number,
  message?: string,
): AgentStateUpdate => ({
  messages: [
    new AIMessage(
      message ?? `Unable to complete ${name}: exceeded the maximum of ${maxSteps} tool steps.`,
    ),
  ],
});

const isCompletionFallbackMessage = (
  message: BaseMessage | undefined,
  completionFallback: string | undefined,
): message is AIMessage => {
  if (!completionFallback || !(message instanceof AIMessage) || message.tool_calls?.length) {
    return false;
  }

  return extractMessageTextContent(message.content).trim() === completionFallback;
};

/**
 * Unified finalize mapper for runtime sub-agents.
 * Product variance is expressed via options (summary builders, write gate, copy) — not separate pipelines.
 */
export const mapSubAgentResult = (
  result: SubAgentState,
  { maxSteps, name }: { maxSteps: number; name: string },
  options: MapSubAgentResultOptions = {},
): AgentStateUpdate => {
  const {
    buildSummary,
    completionFallback,
    maxStepsMessage,
    isSuccessfulSideEffect,
    emptyHandoffWhenNoSalvage,
  } = options;

  const lastMessage = result.agentMessages[result.agentMessages.length - 1];

  if (hasCompletedAgentReply(lastMessage, completionFallback ?? "")) {
    return { messages: [lastMessage] };
  }

  const summary = buildSummary?.(result.agentMessages);

  if (isSuccessfulSideEffect?.(result.agentMessages)) {
    return { messages: [new AIMessage(summary ?? completionFallback ?? "")] };
  }

  if (summary) {
    return { messages: [new AIMessage(summary)] };
  }

  if (result.stepCount >= maxSteps) {
    const resolvedMaxStepsMessage = typeof maxStepsMessage === "function"
      ? maxStepsMessage({ maxSteps, name })
      : maxStepsMessage;
    return createMaxStepsExceededUpdate(name, maxSteps, resolvedMaxStepsMessage);
  }

  if (isCompletionFallbackMessage(lastMessage, completionFallback) && !emptyHandoffWhenNoSalvage) {
    return { messages: [lastMessage] };
  }

  if (emptyHandoffWhenNoSalvage) {
    return { messages: [new AIMessage({ content: "" })] };
  }

  return {
    messages: [lastMessage as AIMessage],
  };
};
