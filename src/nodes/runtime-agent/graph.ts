import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import type { RuntimeAgentRepository } from "../../runtime-agents/repository.js";
import {
  resolveRuntimeToolBundles,
  type RuntimeToolBundleDeps,
} from "../../runtime-agents/tool-bundles.js";
import { RUNTIME_AGENT_CONTEXT_KEY, type RuntimeAgentExecutor } from "../../runtime-agents/types.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { createCompiledSubAgentGraph } from "../create-sub-agent.js";
import { createSubgraphNodeWrapper } from "../subgraph-wrapper.js";
import type { SubAgentState } from "../sub-agent-state.js";
import { createRuntimeAgentFailureMessage, createRuntimeAgentNode } from "./node.js";

type RuntimeExecutorHandlers = Record<
  Exclude<RuntimeAgentExecutor, "generic">,
  (parentState: AgentState) => Promise<AgentStateUpdate>
>;

type RuntimeAgentDispatcherDeps = RuntimeToolBundleDeps & {
  model: BaseChatModel;
  repository: RuntimeAgentRepository;
  handlers: RuntimeExecutorHandlers;
};

const compiledSubgraphCache = new Map<string, ReturnType<typeof createCompiledSubAgentGraph>>();

const getCompiledGenericRuntimeSubgraph = (
  deps: RuntimeAgentDispatcherDeps,
  definition: Awaited<ReturnType<RuntimeAgentRepository["getAgent"]>> & object,
) => {
  const cacheKey = `${definition.id}:${definition.updatedAt}`;
  const cached = compiledSubgraphCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const tools = resolveRuntimeToolBundles(definition.toolBundleIds, deps);
  const llmNode = createRuntimeAgentNode(deps.model, definition, tools);
  const compiled = createCompiledSubAgentGraph(definition.name, definition.maxSteps, llmNode, tools);

  compiledSubgraphCache.set(cacheKey, compiled);
  return compiled;
};

const invokeGenericRuntimeAgent = async (
  deps: RuntimeAgentDispatcherDeps,
  parentState: AgentState,
  definition: NonNullable<Awaited<ReturnType<RuntimeAgentRepository["getAgent"]>>>,
): Promise<AgentStateUpdate> => {
  const compiledSubgraph = getCompiledGenericRuntimeSubgraph(deps, definition);

  return createSubgraphNodeWrapper({
    subgraphName: definition.name,
    buildInitialState: (state) => ({
      messages: state.messages,
      stepCount: 0,
    }),
    compiledSubgraph,
    mapResult: (result: SubAgentState) => {
      if (result.stepCount >= definition.maxSteps) {
        return {
          messages: [
            new AIMessage(
              `Unable to complete ${definition.name}: exceeded the maximum of ${definition.maxSteps} tool steps.`,
            ),
          ],
        };
      }

      const lastMessage = result.messages[result.messages.length - 1];
      return {
        messages: [lastMessage as AIMessage],
      };
    },
  })(parentState);
};

export const createRuntimeAgentDispatcher = (deps: RuntimeAgentDispatcherDeps) =>
  async (parentState: AgentState): Promise<AgentStateUpdate> => {
    const runtimeAgentId = parentState.context[RUNTIME_AGENT_CONTEXT_KEY];

    if (typeof runtimeAgentId !== "string" || runtimeAgentId.trim().length === 0) {
      return {
        messages: [createRuntimeAgentFailureMessage("No runtime agent was selected for dispatch.")],
      };
    }

    const definition = await deps.repository.getAgent(runtimeAgentId);

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
      const executor = definition.executor ?? "generic";

      if (executor !== "generic") {
        return deps.handlers[executor](parentState);
      }

      return invokeGenericRuntimeAgent(deps, parentState, definition);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [createRuntimeAgentFailureMessage(`Runtime agent ${definition.name} failed: ${message}`)],
      };
    }
  };

export type RuntimeAgentGraphDeps = RuntimeAgentDispatcherDeps & {
  supabaseSession?: SupabaseMcpSession;
  fileSender?: IFileSender;
};
