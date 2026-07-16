import { AIMessage } from "@langchain/core/messages";

import { resolveModel, type RuntimeAgentExecutionContext } from "../execution/context.js";
import { createCompiledSubAgentGraph } from "../execution/create-sub-agent.js";
import { createRuntimeAgentNode } from "../execution/runtime-node.js";
import { createSubgraphNodeWrapper } from "../execution/subgraph-wrapper.js";
import type { SubAgentState } from "../execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { RuntimeAgentPolicy } from "../types/policy.js";

export type GenericPolicyDeps = {
  resolveToolBundles: (
    bundleIds: RuntimeAgentDefinition["toolBundleIds"],
    bundleDeps: Record<string, unknown>,
  ) => import("@langchain/core/tools").StructuredToolInterface[];
};

const compiledSubgraphCache = new WeakMap<
  RuntimeAgentExecutionContext,
  Map<string, ReturnType<typeof createCompiledSubAgentGraph>>
>();

const getCompiledSubgraphCache = (
  context: RuntimeAgentExecutionContext,
): Map<string, ReturnType<typeof createCompiledSubAgentGraph>> => {
  let cache = compiledSubgraphCache.get(context);

  if (!cache) {
    cache = new Map();
    compiledSubgraphCache.set(context, cache);
  }

  return cache;
};

export const createGenericPolicy = (deps: GenericPolicyDeps): RuntimeAgentPolicy => ({
  executor: "generic",
  createHandler: (context, definition) => {
    const resolvedDefinition = context.promptResolver.withResolvedSystemPrompt(definition);

    return createSubgraphNodeWrapper({
      subgraphName: resolvedDefinition.name,
      buildInitialState: (state) => ({
        messages: state.messages,
        stepCount: 0,
      }),
      compiledSubgraph: getCompiledGenericRuntimeSubgraph(context, resolvedDefinition, deps),
      mapResult: (result: SubAgentState) => {
        if (result.stepCount >= resolvedDefinition.maxSteps) {
          return {
            messages: [
              new AIMessage(
                `Unable to complete ${resolvedDefinition.name}: exceeded the maximum of ${resolvedDefinition.maxSteps} tool steps.`,
              ),
            ],
          };
        }

        const lastMessage = result.messages[result.messages.length - 1];
        return {
          messages: [lastMessage as AIMessage],
        };
      },
    });
  },
});

const getCompiledGenericRuntimeSubgraph = (
  context: RuntimeAgentExecutionContext,
  definition: RuntimeAgentDefinition,
  deps: GenericPolicyDeps,
) => {
  const cacheKey = [
    context.instanceId,
    definition.id,
    definition.updatedAt,
    context.defaultModelKey,
    definition.toolBundleIds.join(","),
  ].join(":");
  const cache = getCompiledSubgraphCache(context);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const tools = deps.resolveToolBundles(definition.toolBundleIds, context.bundleDeps);
  const model = resolveModel(context);
  const llmNode = createRuntimeAgentNode(model, definition, tools);
  const compiled = createCompiledSubAgentGraph(definition.name, definition.maxSteps, llmNode, tools);

  cache.set(cacheKey, compiled);
  return compiled;
};
