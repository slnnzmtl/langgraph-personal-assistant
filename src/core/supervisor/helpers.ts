import { AIMessage } from "@langchain/core/messages";

import { isRuntimeAgentHandoffComplete } from "../execution/runtime-agent-handoff.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import { normalizeSupervisorReply, type RoutingDecision } from "./routing-schema.js";

export const routeToRuntimeAgent = (agentId: string): AgentStateUpdate => ({
  next: agentId,
  lastHandoff: null,
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

export const needsEmptySubAgentSummary = (state: AgentState): boolean =>
  state.lastHandoff?.status === "empty";

export const detectCompletionState = (state: AgentState): AgentStateUpdate | null => {
  if (needsEmptySubAgentSummary(state)) {
    return null;
  }

  if (isRuntimeAgentHandoffComplete(state.lastHandoff)) {
    return { next: "FINISH", lastHandoff: null };
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
      lastHandoff: null,
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
