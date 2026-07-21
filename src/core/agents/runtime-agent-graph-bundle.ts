import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { createSubgraphNodeWrapper } from "../execution/subgraph-wrapper.js";
import { scopeSubAgentMessages } from "../execution/sub-agent-messages.js";
import type { SubAgentState } from "../execution/sub-agent-state.js";
import type { RuntimeAgentPolicyHandler } from "../types/policy.js";

export type CompiledRuntimeAgentGraph = {
  invoke(input: SubAgentState, config?: unknown): Promise<SubAgentState>;
};

export type RuntimeAgentGraphBundle = {
  name: string;
  prepare: (parentState: AgentState) => SubAgentState;
  subgraph: CompiledRuntimeAgentGraph;
  finalize: (result: SubAgentState) => AgentStateUpdate;
};

export const createDefaultPrepare = (parentState: AgentState): SubAgentState => ({
  agentMessages: scopeSubAgentMessages(parentState.messages),
  stepCount: 0,
});

export const graphBundleToHandler = (bundle: RuntimeAgentGraphBundle): RuntimeAgentPolicyHandler =>
  createSubgraphNodeWrapper({
    subgraphName: bundle.name,
    buildInitialState: bundle.prepare,
    compiledSubgraph: bundle.subgraph,
    mapResult: bundle.finalize,
  });

export const createUnavailableGraphBundle = (
  name: string,
  message: string,
): RuntimeAgentGraphBundle => ({
  name,
  prepare: () => ({ agentMessages: [], stepCount: 0 }),
  subgraph: {
    invoke: async () => ({ agentMessages: [], stepCount: 0 }),
  },
  finalize: () => ({ messages: [new AIMessage(message)] }),
});

export const getSubAgentLastMessage = (state: { agentMessages: BaseMessage[] }): BaseMessage | undefined =>
  state.agentMessages[state.agentMessages.length - 1];
