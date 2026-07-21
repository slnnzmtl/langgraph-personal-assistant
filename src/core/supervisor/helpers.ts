import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import { getRuntimeAgentHandoff, isRuntimeAgentHandoffComplete } from "../execution/runtime-agent-handoff.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import { normalizeSupervisorReply, type RoutingDecision } from "./routing-schema.js";

export type ResolveAgentId = (routeOrId: string) => string;

export const defaultResolveAgentId: ResolveAgentId = (routeOrId) => routeOrId;

export const createResolveAgentId = (resolveAgentId?: ResolveAgentId): ResolveAgentId =>
  resolveAgentId ?? defaultResolveAgentId;

export const routeToRuntimeAgent = (agentId: string): AgentStateUpdate => ({
  next: agentId,
  context: {
    [RUNTIME_AGENT_CONTEXT_KEY]: agentId,
  },
});

export const tryCronRouteUpdate = (
  cronRoute: string | undefined,
  superviseCronRoute: string | undefined,
  resolveAgentId: ResolveAgentId,
  wiredAgentIds?: ReadonlySet<string>,
): AgentStateUpdate | null => {
  if (!cronRoute || cronRoute === superviseCronRoute) {
    return null;
  }

  const agentId = resolveAgentId(cronRoute);

  if (wiredAgentIds && !wiredAgentIds.has(agentId)) {
    return null;
  }

  return routeToRuntimeAgent(agentId);
};

export const needsEmptySubAgentSummary = (state: AgentState): boolean => {
  const lastMessage = state.messages[state.messages.length - 1];
  return getRuntimeAgentHandoff(lastMessage)?.status === "empty";
};

export const detectCompletionState = (
  state: AgentState,
  _promptMessages: BaseMessage[],
): AgentStateUpdate | null => {
  if (needsEmptySubAgentSummary(state)) {
    return null;
  }

  const lastMessage = state.messages[state.messages.length - 1];

  if (isRuntimeAgentHandoffComplete(lastMessage)) {
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
