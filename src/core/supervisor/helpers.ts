import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import { getRuntimeAgentHandoff, isRuntimeAgentHandoffComplete } from "../execution/runtime-agent-handoff.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import { normalizeSupervisorReply, type RoutingDecision } from "./routing-schema.js";

export const routeToRuntimeAgent = (agentId: string): AgentStateUpdate => ({
  next: agentId,
  context: {
    [RUNTIME_AGENT_CONTEXT_KEY]: agentId,
  },
});

export const tryCronRouteUpdate = (
  cronRoute: string | undefined,
  superviseCronRoute: string | undefined,
  wiredAgentIds?: ReadonlySet<string>,
): AgentStateUpdate | null => {
  if (!cronRoute || cronRoute === superviseCronRoute) {
    return null;
  }

  if (wiredAgentIds && !wiredAgentIds.has(cronRoute)) {
    return null;
  }

  return routeToRuntimeAgent(cronRoute);
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

  if (!enabledAgentIds.has(response.next)) {
    return onFailure(`Unknown or disabled runtime agent route: ${response.next}`);
  }

  if (response.reply !== undefined) {
    console.warn(
      `Supervisor routing ignored a reply while delegating to ${response.next}.`,
    );
  }

  return routeToRuntimeAgent(response.next);
};
