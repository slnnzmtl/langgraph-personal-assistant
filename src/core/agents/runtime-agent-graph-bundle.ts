import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { scopeSubAgentMessages } from "../execution/sub-agent-messages.js";
import type { SubAgentState, SubAgentStateUpdate } from "../execution/sub-agent-state.js";

export type RuntimeAgentLoopNode = (
  state: SubAgentState,
  config?: RunnableConfig,
) => Promise<SubAgentStateUpdate>;

/**
 * Flat runtime-agent wiring for the parent StateGraph.
 * Intentionally does NOT include a compiled subgraph — nesting a compiled graph
 * under another StateGraph triggers LangChainTracer duplicate-handler noise
 * (langchainjs#11189).
 */
export type RuntimeAgentGraphBundle = {
  name: string;
  maxSteps: number;
  prepare: (parentState: AgentState) => SubAgentState;
  llmNode: RuntimeAgentLoopNode;
  toolsNode: RuntimeAgentLoopNode;
  finalize: (result: SubAgentState) => AgentStateUpdate;
};

export const createDefaultPrepare = (parentState: AgentState): SubAgentState => ({
  agentMessages: scopeSubAgentMessages(parentState.messages),
  stepCount: 0,
});

export const createUnavailableGraphBundle = (
  name: string,
  message: string,
): RuntimeAgentGraphBundle => ({
  name,
  maxSteps: 0,
  prepare: () => ({ agentMessages: [], stepCount: 0 }),
  llmNode: async () => ({ agentMessages: [], stepCount: 0 }),
  toolsNode: async () => ({}),
  finalize: () => ({ messages: [new AIMessage(message)] }),
});

export const getSubAgentLastMessage = (state: { agentMessages: BaseMessage[] }): BaseMessage | undefined =>
  state.agentMessages[state.agentMessages.length - 1];
