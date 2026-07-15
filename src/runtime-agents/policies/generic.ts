import { AIMessage } from "@langchain/core/messages";

import { createCompiledSubAgentGraph } from "../execution/create-sub-agent.js";
import { createSubgraphNodeWrapper } from "../execution/subgraph-wrapper.js";
import type { SubAgentState } from "../execution/sub-agent-state.js";
import { createRuntimeAgentNode } from "../execution/generic-node.js";
import type { RuntimeAgentExecutionContext } from "../execution-context.js";
import { withResolvedSystemPrompt } from "../prompt-resolver.js";
import { resolveRuntimeToolBundles } from "../tool-bundles.js";
import type { RuntimeAgentDefinition } from "../types.js";
import type { RuntimeAgentPolicy } from "./types.js";

const compiledSubgraphCache = new Map<string, ReturnType<typeof createCompiledSubAgentGraph>>();

const getCompiledGenericRuntimeSubgraph = (
  context: RuntimeAgentExecutionContext,
  definition: RuntimeAgentDefinition,
) => {
  const resolvedDefinition = withResolvedSystemPrompt(definition);
  const cacheKey = `${resolvedDefinition.id}:${resolvedDefinition.updatedAt}`;
  const cached = compiledSubgraphCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const tools = resolveRuntimeToolBundles(resolvedDefinition.toolBundleIds, context.bundleDeps);
  const llmNode = createRuntimeAgentNode(context.models.generic, resolvedDefinition, tools);
  const compiled = createCompiledSubAgentGraph(resolvedDefinition.name, resolvedDefinition.maxSteps, llmNode, tools);

  compiledSubgraphCache.set(cacheKey, compiled);
  return compiled;
};

export const genericPolicy: RuntimeAgentPolicy = {
  executor: "generic",
  createHandler: (context, definition) => {
    const resolvedDefinition = withResolvedSystemPrompt(definition);

    return createSubgraphNodeWrapper({
      subgraphName: resolvedDefinition.name,
      buildInitialState: (state) => ({
        messages: state.messages,
        stepCount: 0,
      }),
      compiledSubgraph: getCompiledGenericRuntimeSubgraph(context, resolvedDefinition),
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
};
