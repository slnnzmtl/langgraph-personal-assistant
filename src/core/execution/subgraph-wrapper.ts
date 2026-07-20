import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import type { AgentState, AgentStateUpdate } from "../state.js";

export const createSubgraphNodeWrapper = <TState extends { messages: BaseMessage[] }>(options: {
  subgraphName: string;
  buildInitialState: (parentState: AgentState) => TState;
  compiledSubgraph: { invoke(input: TState): Promise<TState> };
  mapResult?: (result: TState) => AgentStateUpdate;
}) =>
  async (parentState: AgentState): Promise<AgentStateUpdate> => {
    try {
      const result = await options.compiledSubgraph.invoke(options.buildInitialState(parentState));

      if (options.mapResult) {
        return options.mapResult(result);
      }

      const lastMessage = result.messages[result.messages.length - 1];
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
