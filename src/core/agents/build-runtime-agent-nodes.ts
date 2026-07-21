import {
  applyRuntimeAgentHandoffToUpdate,
} from "../execution/runtime-agent-handoff.js";

import { Overwrite } from "@langchain/langgraph";

import type { RuntimeAgentExecutionContext } from "../execution/context.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { RuntimeAgentGraphBundle } from "./runtime-agent-graph-bundle.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import type { SubAgentState } from "../execution/sub-agent-state.js";

export const runtimeAgentPrepareNodeName = (agentId: string): string => `${agentId}__prepare`;
export const runtimeAgentLlmNodeName = (agentId: string): string => `${agentId}__llm`;
export const runtimeAgentToolsNodeName = (agentId: string): string => `${agentId}__tools`;
export const runtimeAgentFinalizeNodeName = (agentId: string): string => `${agentId}__finalize`;

export type RuntimeAgentGraphNodeSet = {
  agentId: string;
  bundle: RuntimeAgentGraphBundle;
  prepareNodeName: string;
  llmNodeName: string;
  toolsNodeName: string;
  finalizeNodeName: string;
};

export const buildRuntimeAgentGraphNodeSets = (
  agents: RuntimeAgentDefinition[],
  context: RuntimeAgentExecutionContext,
): RuntimeAgentGraphNodeSet[] =>
  agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const resolved = context.promptResolver.withResolvedSystemPrompt(agent);
      const policy = context.policyRegistry.get(resolved.executor ?? "generic");
      const bundle = policy.createGraphBundle(context, resolved);

      return {
        agentId: agent.id,
        bundle,
        prepareNodeName: runtimeAgentPrepareNodeName(agent.id),
        llmNodeName: runtimeAgentLlmNodeName(agent.id),
        toolsNodeName: runtimeAgentToolsNodeName(agent.id),
        finalizeNodeName: runtimeAgentFinalizeNodeName(agent.id),
      };
    });

export const createRuntimeAgentPrepareNode = (bundle: RuntimeAgentGraphBundle) =>
  (state: AgentState): AgentStateUpdate => {
    const prepared = bundle.prepare(state);

    return {
      agentMessages: new Overwrite(prepared.agentMessages),
      stepCount: prepared.stepCount,
    };
  };

export const createRuntimeAgentFinalizeNode = (
  bundle: RuntimeAgentGraphBundle,
  agentId: string,
) =>
  (state: AgentState): AgentStateUpdate => {
    const agentMessages = state.agentMessages ?? [];
    const stepCount = state.stepCount ?? 0;
    const finalized = bundle.finalize({ agentMessages, stepCount });
    const handoffMessages = Array.isArray(finalized.messages) ? finalized.messages : undefined;
    const withHandoff = handoffMessages
      ? applyRuntimeAgentHandoffToUpdate(
        { messages: handoffMessages },
        {
          agentId,
          agentName: bundle.name,
          agentMessages,
          stepCount,
          maxSteps: bundle.maxSteps,
        },
      )
      : undefined;

    return {
      ...finalized,
      ...(withHandoff ? { messages: withHandoff.messages } : {}),
      agentMessages: new Overwrite([]),
      stepCount: 0,
    };
  };

export const routeAfterRuntimeAgentLlm = (
  state: SubAgentState,
  maxSteps: number,
  toolsNodeName: string,
  finalizeNodeName: string,
): string => {
  if (state.stepCount >= maxSteps) {
    return finalizeNodeName;
  }

  if (hasPendingToolCalls(state.agentMessages) || lastMessageRequestsTools(state.agentMessages)) {
    return toolsNodeName;
  }

  return finalizeNodeName;
};

export const routeAfterRuntimeAgentTools = (
  state: SubAgentState,
  llmNodeName: string,
  toolsNodeName: string,
): string => {
  if (hasPendingToolCalls(state.agentMessages)) {
    return toolsNodeName;
  }

  return llmNodeName;
};
