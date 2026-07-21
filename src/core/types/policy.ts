import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "./agent.js";
import type { PolicyContext } from "./policy-context.js";
import type { RuntimeAgentGraphBundle } from "../agents/runtime-agent-graph-bundle.js";

export type RuntimeAgentPolicy = {
  readonly executor: string;
  /** Definition must have its system prompt already resolved when invoked from graph compilation. */
  createGraphBundle: (
    context: PolicyContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentGraphBundle;
};

export const createRuntimeAgentPolicy = (
  executor: string,
  createGraphBundle: RuntimeAgentPolicy["createGraphBundle"],
): RuntimeAgentPolicy => ({
  executor,
  createGraphBundle,
});
