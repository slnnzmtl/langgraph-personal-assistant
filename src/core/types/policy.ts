import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "./agent.js";
import type { RuntimeAgentExecutionContext } from "../execution/context.js";

export type RuntimeAgentPolicyHandler = (
  parentState: AgentState,
) => Promise<AgentStateUpdate>;

export type RuntimeAgentPolicy = {
  readonly executor: string;
  /** Definition must have its system prompt already resolved when invoked from dispatch. */
  createHandler: (
    context: RuntimeAgentExecutionContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentPolicyHandler;
};
