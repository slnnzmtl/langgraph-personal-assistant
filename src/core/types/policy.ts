import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentDefinition } from "./agent.js";
import type { PolicyContext } from "./policy-context.js";
import type { RuntimeAgentGraphBundle } from "../agents/runtime-agent-graph-bundle.js";
import { graphBundleToHandler } from "../agents/runtime-agent-graph-bundle.js";

export type { RuntimeAgentGraphBundle };

export type RuntimeAgentPolicyHandler = (
  parentState: AgentState,
  config?: RunnableConfig,
) => Promise<AgentStateUpdate>;

export type RuntimeAgentPolicy = {
  readonly executor: string;
  /** Definition must have its system prompt already resolved when invoked from dispatch. */
  createGraphBundle: (
    context: PolicyContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentGraphBundle;
  createHandler?: (
    context: PolicyContext,
    definition: RuntimeAgentDefinition,
  ) => RuntimeAgentPolicyHandler;
};

export const createRuntimeAgentPolicy = (
  executor: string,
  createGraphBundle: RuntimeAgentPolicy["createGraphBundle"],
): RuntimeAgentPolicy => ({
  executor,
  createGraphBundle,
  createHandler: (context, definition) =>
    graphBundleToHandler(createGraphBundle(context, definition)),
});

export const resolveRuntimeAgentPolicyHandler = (
  policy: RuntimeAgentPolicy,
  context: PolicyContext,
  definition: RuntimeAgentDefinition,
): RuntimeAgentPolicyHandler =>
  policy.createHandler?.(context, definition)
  ?? graphBundleToHandler(policy.createGraphBundle(context, definition));
