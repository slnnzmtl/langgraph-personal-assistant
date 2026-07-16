import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "./agent.js";
import type { RuntimeAgentExecutionContext } from "../execution/context.js";

export type RuntimeAgentPolicyHandler = (
  parentState: AgentState,
) => Promise<AgentStateUpdate>;

export type RuntimeAgentPolicy = {
  readonly executor: string;
  createHandler: (
    context: RuntimeAgentExecutionContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentPolicyHandler;
};
