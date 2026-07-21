import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { createRuntimeAgentFailureMessage } from "../execution/runtime-node.js";
import type { RuntimeAgentPolicyHandler } from "../types/policy.js";
import { resolveRuntimeAgentPolicyHandler } from "../types/policy.js";
import type { RuntimeAgentExecutionContext } from "../execution/context.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";

const handlerCache = new WeakMap<RuntimeAgentExecutionContext, Map<string, RuntimeAgentPolicyHandler>>();

const getHandlerCache = (context: RuntimeAgentExecutionContext): Map<string, RuntimeAgentPolicyHandler> => {
  let cache = handlerCache.get(context);

  if (!cache) {
    cache = new Map();
    handlerCache.set(context, cache);
  }

  return cache;
};

const resolvePolicyHandler = (
  context: RuntimeAgentExecutionContext,
  executor: string,
  definition: ReturnType<RuntimeAgentExecutionContext["promptResolver"]["withResolvedSystemPrompt"]>,
): RuntimeAgentPolicyHandler => {
  const policy = context.policyRegistry.get(definition.executor ?? "generic");
  const cacheKey = executor === "generic"
    ? `${definition.id}:${definition.updatedAt}`
    : executor;

  const cache = getHandlerCache(context);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const handler = resolveRuntimeAgentPolicyHandler(policy, context, definition);
  cache.set(cacheKey, handler);
  return handler;
};

export const createRuntimeAgentDispatcher = (context: RuntimeAgentExecutionContext) =>
  async (parentState: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
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
      const resolvedDefinition = context.promptResolver.withResolvedSystemPrompt(definition);
      const executor = resolvedDefinition.executor ?? "generic";
      const handler = resolvePolicyHandler(context, executor, resolvedDefinition);
      return handler(parentState, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [createRuntimeAgentFailureMessage(`Runtime agent ${definition.name} failed: ${message}`)],
      };
    }
  };
