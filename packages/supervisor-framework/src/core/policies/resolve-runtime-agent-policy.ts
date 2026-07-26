import type { RuntimeAgentDefinition } from "../types/agent.js";

/** Default executor for all runtime agents (single shared policy builder). */
export const DEFAULT_RUNTIME_EXECUTOR = "generic" as const;

/** @deprecated All agents use DEFAULT_RUNTIME_EXECUTOR; configuration behavior is capability-composed. */
export const SYSTEM_AGENT_EXECUTOR = "configuration" as const;

/** Maps an agent definition to the registered runtime policy executor key. */
export const resolveRuntimeAgentPolicyExecutor = (
  _definition: RuntimeAgentDefinition,
): string => DEFAULT_RUNTIME_EXECUTOR;
