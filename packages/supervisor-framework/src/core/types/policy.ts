import type { RuntimeAgentDefinition } from "./agent.js";
import type { RuntimeAgentExecutionContext } from "../execution/context.js";
import type { RuntimeAgentGraphBundle } from "../agents/runtime-agent-graph-bundle.js";

export type RuntimeAgentPolicy = {
  /** Definition must have its system prompt already resolved when invoked from graph compilation. */
  createGraphBundle: (
    context: RuntimeAgentExecutionContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentGraphBundle;
};
