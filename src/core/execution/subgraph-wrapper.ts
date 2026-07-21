import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { getSubAgentLastMessage } from "../agents/runtime-agent-graph-bundle.js";

export const createSubgraphNodeWrapper = <TState extends { agentMessages: BaseMessage[] }>(options: {
  subgraphName: string;
  buildInitialState: (parentState: AgentState) => TState;
  compiledSubgraph: { invoke(input: TState, config?: RunnableConfig): Promise<TState> };
  mapResult?: (result: TState) => AgentStateUpdate;
}) =>
  async (parentState: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    try {
      const result = await options.compiledSubgraph.invoke(
        options.buildInitialState(parentState),
        config,
      );

      if (options.mapResult) {
        return options.mapResult(result);
      }

      const lastMessage = getSubAgentLastMessage(result);
      return {
        messages: [lastMessage as AIMessage],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [new AIMessage(`${options.subgraphName} sub-graph failed: ${message}`)],
      };
    }
  };
