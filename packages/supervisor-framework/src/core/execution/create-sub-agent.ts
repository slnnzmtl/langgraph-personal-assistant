import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import type { AgentState, AgentStateUpdate } from "../state.js";
import {
  type RuntimeAgentGraphBundle,
  type RuntimeAgentLoopNode,
} from "../agents/runtime-agent-graph-bundle.js";
import type { SubAgentToolSource } from "./runtime-node.js";
import {
  type SubAgentState,
  type SubAgentStateUpdate,
} from "./sub-agent-state.js";
import { mapSubAgentResult } from "./map-sub-agent-result.js";

export type SubAgentLlmNode = RuntimeAgentLoopNode;

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
  messageHistoryMaxTokens?: number;
};

export const createSubAgentToolsNode = (tools: SubAgentToolSource): RuntimeAgentLoopNode => {
  const toolNode = new ToolNode(tools);

  return async (state: SubAgentState, config?: RunnableConfig): Promise<SubAgentStateUpdate> => {
    // Call ToolNode.run directly — toolNode.invoke() nests another Runnable and
    // re-triggers the LangChainTracer duplicate-handler bug (langchainjs#11189).
    const result = await (
      toolNode as unknown as {
        run(
          input: { messages: SubAgentState["agentMessages"] },
          config?: RunnableConfig,
        ): Promise<{ messages: SubAgentState["agentMessages"] }>;
      }
    ).run({ messages: state.agentMessages }, config);

    return { agentMessages: result.messages };
  };
};

export const createSubAgentGraphBundle = <TDeps>(config: SubAgentConfig<TDeps>): RuntimeAgentGraphBundle => {
  const tools = config.createTools(config.deps);
  const llmNode = config.createLlmNode(config.deps, tools);
  const toolsNode = createSubAgentToolsNode(tools);

  return {
    name: config.name,
    maxSteps: config.maxSteps,
    prepare:
      config.buildInitialState
      ?? (() => ({
        // Prepare-node owns agent-scoped history from parent messages.
        agentMessages: [],
        stepCount: 0,
      })),
    llmNode,
    toolsNode,
    finalize: config.mapResult
      ? (result) => config.mapResult!(result, { maxSteps: config.maxSteps, name: config.name })
      : (result) => mapSubAgentResult(result, { maxSteps: config.maxSteps, name: config.name }),
  };
};

export {
  createMaxStepsExceededUpdate,
  mapSubAgentResult,
  type MapSubAgentResultOptions,
} from "./map-sub-agent-result.js";

export { createDefaultPrepare } from "../agents/runtime-agent-graph-bundle.js";