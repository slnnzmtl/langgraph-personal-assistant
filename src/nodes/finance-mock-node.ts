import { AIMessage } from "@langchain/core/messages";

import type { AgentState, AgentStateUpdate } from "../state.js";

export const financeMockNode = async (
  _state: AgentState,
): Promise<AgentStateUpdate> => ({
  messages: [
    new AIMessage(
      "Mock Finance Sub-Graph Executed. Phase 1 only wires routing and Telegram delivery.",
    ),
  ],
});