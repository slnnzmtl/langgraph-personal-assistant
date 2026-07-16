import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END, START, StateGraph } from "@langchain/langgraph";

import type { AgentState, AgentStateUpdate } from "../state.js";
import { createGuardedToolNode, createStaticToolNode } from "../../tools/guarded-tool-node.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import { createSubgraphNodeWrapper } from "./subgraph-wrapper.js";
import {
  isSkillScopedToolContext,
  resolveSubAgentTools,
  type SubAgentToolSource,
} from "./runtime-node.js";
import {
  SubAgentStateAnnotation,
  type SubAgentState,
  type SubAgentStateUpdate,
} from "./sub-agent-state.js";

export type { SubAgentToolSource } from "./runtime-node.js";
export { isSkillScopedToolContext, resolveSubAgentTools } from "./runtime-node.js";

export type SubAgentLlmNode = (
  state: SubAgentState,
) => Promise<SubAgentStateUpdate>;

export type SubAgentConfig<TDeps> = {
  name: string;
  maxSteps: number;
  deps: TDeps;
  createTools: (deps: TDeps) => SubAgentToolSource;
  createLlmNode: (deps: TDeps, tools: SubAgentToolSource) => SubAgentLlmNode;
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
  buildInitialState?: (parentState: AgentState) => SubAgentState;
};

export const createCompiledSubAgentGraph = (
  name: string,
  maxSteps: number,
  llmNode: SubAgentLlmNode,
  tools: SubAgentToolSource,
) => {
  const toolsNode = isSkillScopedToolContext(tools)
    ? createGuardedToolNode(tools)
    : createStaticToolNode(resolveSubAgentTools(tools));

  const graph = new StateGraph(SubAgentStateAnnotation)
    .addNode("llm", llmNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: SubAgentState) => {
      if (state.stepCount >= maxSteps) {
        return END;
      }

      if (hasPendingToolCalls(state.messages) || lastMessageRequestsTools(state.messages)) {
        return "tools";
      }

      return END;
    })
    .addConditionalEdges("tools", (state: SubAgentState) => {
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }

      return "llm";
    });

  return graph.compile({ name: `${name.toLowerCase()}-subgraph` });
};

export const createSubAgent = <TDeps>(config: SubAgentConfig<TDeps>) => {
  const tools = config.createTools(config.deps);
  const llmNode = config.createLlmNode(config.deps, tools);
  const compiledSubgraph = createCompiledSubAgentGraph(config.name, config.maxSteps, llmNode, tools);

  return createSubgraphNodeWrapper<SubAgentState>({
    subgraphName: config.name,
    buildInitialState:
      config.buildInitialState
      ?? ((parentState) => ({
        messages: parentState.messages,
        stepCount: 0,
      })),
    compiledSubgraph,
    ...(config.mapResult
      ? {
          mapResult: (result: SubAgentState) =>
            config.mapResult!(result, { maxSteps: config.maxSteps, name: config.name }),
        }
      : {}),
  });
};

export const createSubAgentOrStub = <TDeps>(
  isAvailable: (deps: TDeps) => boolean,
  unavailableMessage: string,
  config: SubAgentConfig<TDeps>,
) => {
  if (!isAvailable(config.deps)) {
    return async (_state: AgentState): Promise<AgentStateUpdate> => ({
      messages: [new AIMessage(unavailableMessage)],
    });
  }

  return createSubAgent(config);
};

export const filterToolsByNames = (
  tools: StructuredToolInterface[],
  allowedNames: string[],
  options?: { alwaysInclude?: string[] },
): StructuredToolInterface[] => {
  const allowed = new Set([
    ...allowedNames,
    ...(options?.alwaysInclude ?? []),
  ]);

  return tools.filter((tool) => allowed.has(tool.name));
};

export const resolveTurnTools = (
  toolSource: SubAgentToolSource,
  messages: BaseMessage[],
  options?: {
    restrictToNames?: string[];
    alwaysInclude?: string[];
  },
): StructuredToolInterface[] => {
  const scopedTools = isSkillScopedToolContext(toolSource)
    ? toolSource.resolveToolsForTurn(messages)
    : resolveSubAgentTools(toolSource);

  if (!options?.restrictToNames) {
    return scopedTools;
  }

  const filterOptions = options.alwaysInclude
    ? { alwaysInclude: options.alwaysInclude }
    : undefined;

  return filterToolsByNames(scopedTools, options.restrictToNames, filterOptions);
};
