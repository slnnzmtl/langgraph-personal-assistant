import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeAgentExecutionContext } from "./execution-context.js";
import { createRuntimeAgentFailureMessage } from "./execution/generic-node.js";
import { getRuntimeAgentPolicy } from "./policies/registry.js";
import type { RuntimeAgentPolicyHandler } from "./policies/types.js";
import { withResolvedSystemPrompt } from "./prompt-resolver.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "./types.js";

const builtinHandlerCache = new WeakMap<RuntimeAgentExecutionContext, Map<string, RuntimeAgentPolicyHandler>>();

const getBuiltinHandlerCache = (context: RuntimeAgentExecutionContext): Map<string, RuntimeAgentPolicyHandler> => {
  let cache = builtinHandlerCache.get(context);

  if (!cache) {
    cache = new Map();
    builtinHandlerCache.set(context, cache);
  }

  return cache;
};

const resolvePolicyHandler = (
  context: RuntimeAgentExecutionContext,
  executor: string,
  definition: ReturnType<typeof withResolvedSystemPrompt>,
): RuntimeAgentPolicyHandler => {
  const policy = getRuntimeAgentPolicy(definition.executor ?? "generic");
  const cacheKey = executor === "generic"
    ? `${definition.id}:${definition.updatedAt}`
    : executor;

  const cache = getBuiltinHandlerCache(context);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const handler = policy.createHandler(context, definition);
  cache.set(cacheKey, handler);
  return handler;
};

export const createRuntimeAgentDispatcher = (context: RuntimeAgentExecutionContext) =>
  async (parentState: AgentState): Promise<AgentStateUpdate> => {
    const runtimeAgentId = parentState.context[RUNTIME_AGENT_CONTEXT_KEY];

    if (typeof runtimeAgentId !== "string" || runtimeAgentId.trim().length === 0) {
      return {
        messages: [createRuntimeAgentFailureMessage("No runtime agent was selected for dispatch.")],
      };
    }

    const definition = await context.repository.getAgent(runtimeAgentId);

    if (!definition) {
      return {
        messages: [createRuntimeAgentFailureMessage(`Runtime agent not found: ${runtimeAgentId}`)],
      };
    }

    if (!definition.enabled) {
      return {
        messages: [createRuntimeAgentFailureMessage(`Runtime agent is disabled: ${definition.name}`)],
      };
    }

    try {
      const resolvedDefinition = withResolvedSystemPrompt(definition);
      const executor = resolvedDefinition.executor ?? "generic";
      const handler = resolvePolicyHandler(context, executor, resolvedDefinition);
      return handler(parentState);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [createRuntimeAgentFailureMessage(`Runtime agent ${definition.name} failed: ${message}`)],
      };
    }
  };
