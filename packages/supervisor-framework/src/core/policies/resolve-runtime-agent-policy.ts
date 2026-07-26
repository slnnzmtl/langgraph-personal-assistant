import type { RuntimeAgentDefinition } from "../types/agent.js";

/** Default executor for all product runtime agents (tools + optional app-local capability behaviors). */
export const DEFAULT_RUNTIME_EXECUTOR = "generic" as const;

/** Executor key for the virtual system admin agent (matches SYSTEM_AGENT_ID). */
export const SYSTEM_AGENT_EXECUTOR = "configuration" as const;

/** Maps an agent definition to the registered runtime policy executor key. */
export const resolveRuntimeAgentPolicyExecutor = (
  definition: RuntimeAgentDefinition,
): string =>
  definition.executor === SYSTEM_AGENT_EXECUTOR || definition.id === SYSTEM_AGENT_EXECUTOR
    ? SYSTEM_AGENT_EXECUTOR
    : DEFAULT_RUNTIME_EXECUTOR;
