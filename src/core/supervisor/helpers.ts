import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../../utils/message-content.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import type { RoutingDecision } from "./routing-schema.js";

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

export const detectCompletionState = (
  state: AgentState,
  promptMessages: BaseMessage[],
): AgentStateUpdate | null => {
  const lastStripped = promptMessages[promptMessages.length - 1];
  const lastStrippedText = getAiMessageText(lastStripped);

  const isSubAgentComplete =
    lastStripped instanceof AIMessage
    && (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0)
    && lastStrippedText.length > 0;

  if (isSubAgentComplete) {
    return { next: "FINISH" };
  }

  const hasDelegatedToRuntimeAgent = state.messages.some((message) => message instanceof AIMessage);
  const hadRecentToolResult = state.messages.some((message) => {
    if (!(message instanceof ToolMessage)) {
      return false;
    }

    return extractMessageTextContent(message.content).trim().length > 0;
  });

  if (
    hasDelegatedToRuntimeAgent
    && !hadRecentToolResult
    && lastStripped instanceof AIMessage
    && (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0)
    && lastStrippedText.length === 0
  ) {
    return {
      next: "FINISH",
      messages: [new AIMessage("Completed your request.")],
    };
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
    if (typeof response.reply !== "string" || response.reply.trim().length === 0) {
      return onFailure("The routing model returned FINISH without a reply.");
    }

    return {
      next: response.next,
      messages: [new AIMessage(response.reply)],
    };
  }

  const agentId = resolveAgentId(response.next);

  if (!enabledAgentIds.has(agentId)) {
    return onFailure(`Unknown or disabled runtime agent route: ${response.next}`);
  }

  return routeToRuntimeAgent(agentId);
};
