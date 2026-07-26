import { buildRuntimeAgentHandoff } from "../execution/runtime-agent-handoff.js";

import { AIMessage } from "@langchain/core/messages";
import { Overwrite } from "@langchain/langgraph";

import type { RuntimeAgentExecutionContext } from "../execution/context.js";
import { resolveRuntimeAgentPolicyExecutor } from "../policies/resolve-runtime-agent-policy.js";
import { withResolvedAgentSystemPrompt } from "./resolve-system-prompt.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { RuntimeAgentGraphBundle } from "./runtime-agent-graph-bundle.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../execution/tool-routing.js";
import { applyDelegationPrompt } from "../execution/sub-agent-messages.js";
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
      const resolved = withResolvedAgentSystemPrompt(agent, context.loadPromptByKey);
      const policy = context.policyRegistry.get(resolveRuntimeAgentPolicyExecutor(resolved));
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
    const agentMessages = state.delegationPrompt
      ? applyDelegationPrompt(prepared.agentMessages, state.delegationPrompt)
      : prepared.agentMessages;

    return {
      agentMessages: new Overwrite(agentMessages),
      stepCount: prepared.stepCount,
      handoffStatus: undefined,
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

    if (!handoffMessages || handoffMessages.length === 0) {
      return {
        ...finalized,
        agentMessages: new Overwrite([]),
        stepCount: 0,
        handoffStatus: undefined,
      };
    }

    const lastMessage = handoffMessages[handoffMessages.length - 1];

    if (!(lastMessage instanceof AIMessage)) {
      return {
        ...finalized,
        agentMessages: new Overwrite([]),
        stepCount: 0,
        handoffStatus: undefined,
      };
    }

    const lastHandoff = buildRuntimeAgentHandoff({
      agentId,
      agentName: bundle.name,
      message: lastMessage,
      agentMessages,
      stepCount,
      maxSteps: bundle.maxSteps,
      ...(state.handoffStatus ? { explicitStatus: state.handoffStatus } : {}),
    });

    const clearedWorkspace: AgentStateUpdate = {
      agentMessages: new Overwrite([]),
      stepCount: 0,
      handoffStatus: undefined,
    };

    if (lastHandoff.status === "empty") {
      return {
        ...clearedWorkspace,
        lastHandoff,
      };
    }

    return {
      ...finalized,
      ...clearedWorkspace,
      lastHandoff,
      messages: handoffMessages,
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
