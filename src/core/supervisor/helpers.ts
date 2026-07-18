import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import { getEmptySubAgentHandoff, isEmptyAiReply } from "../execution/empty-subagent-handoff.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import { normalizeSupervisorReply, type RoutingDecision } from "./routing-schema.js";

export type ResolveAgentId = (routeOrId: string) => string;

export const defaultResolveAgentId: ResolveAgentId = (routeOrId) => routeOrId;

export const createResolveAgentId = (resolveAgentId?: ResolveAgentId): ResolveAgentId =>
  resolveAgentId ?? defaultResolveAgentId;

export const routeToRuntimeAgent = (agentId: string): AgentStateUpdate => ({
  next: "Runtime_SG",
  context: {
    [RUNTIME_AGENT_CONTEXT_KEY]: agentId,
  },
});

export const tryCronRouteUpdate = (
  cronRoute: string | undefined,
  superviseCronRoute: string | undefined,
  resolveAgentId: ResolveAgentId,
): AgentStateUpdate | null => {
  if (!cronRoute || cronRoute === superviseCronRoute) {
    return null;
  }

  return routeToRuntimeAgent(resolveAgentId(cronRoute));
};

const getAiMessageText = (message: BaseMessage | undefined): string =>
  message instanceof AIMessage ? extractMessageTextContent(message.content).trim() : "";

export const needsEmptySubAgentSummary = (state: AgentState): boolean => {
  const lastMessage = state.messages[state.messages.length - 1];
  // Empty AI from a runtime agent (with or without handoff metadata) must be
  // summarized by the supervisor — never re-routed.
  return Boolean(getEmptySubAgentHandoff(lastMessage)) || isEmptyAiReply(lastMessage);
};

export const detectCompletionState = (
  state: AgentState,
  promptMessages: BaseMessage[],
): AgentStateUpdate | null => {
  if (needsEmptySubAgentSummary(state)) {
    // Supervisor node will generate a user-facing summary before FINISH.
    return null;
  }

  const lastStripped = promptMessages[promptMessages.length - 1];
  const lastStrippedText = getAiMessageText(lastStripped);

  const isSubAgentComplete =
    lastStripped instanceof AIMessage
    && (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0)
    && lastStrippedText.length > 0;

  if (isSubAgentComplete) {
    return { next: "FINISH" };
  }

  return null;
};

export const resolveRoutingDecision = async (
  response: RoutingDecision,
  enabledAgentIds: Set<string>,
  resolveAgentId: ResolveAgentId,
  onFailure: (failureContext: string) => Promise<AgentStateUpdate>,
): Promise<AgentStateUpdate> => {
  if (response.next === "FINISH") {
    const reply = normalizeSupervisorReply(response.reply);

    if (reply === undefined) {
      return onFailure("The routing model returned FINISH without a reply.");
    }

    return {
      next: response.next,
      messages: [new AIMessage(reply)],
    };
  }

  const agentId = resolveAgentId(response.next);

  if (!enabledAgentIds.has(agentId)) {
    return onFailure(`Unknown or disabled runtime agent route: ${response.next}`);
  }

  if (response.reply !== undefined) {
    console.warn(
      `Supervisor routing ignored a reply while delegating to ${response.next}.`,
    );
  }

  return routeToRuntimeAgent(agentId);
};
