import type { AgentState, AgentStateUpdate } from "../../state.js";
import type { RuntimeAgentExecutionContext } from "../execution-context.ts";
import type { RuntimeAgentDefinition, RuntimeAgentExecutor } from "../types.js";

export type RuntimeAgentPolicyHandler = (
  parentState: AgentState,
) => Promise<AgentStateUpdate>;

export type RuntimeAgentPolicy = {
  readonly executor: RuntimeAgentExecutor;
  createHandler: (
    context: RuntimeAgentExecutionContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentPolicyHandler;
};
