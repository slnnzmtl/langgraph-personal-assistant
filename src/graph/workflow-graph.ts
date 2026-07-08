import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";
import path from "node:path";

import type { AppConfig } from "../config.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import { createCronJobRepository } from "../cron/cron-job-repository.js";
import { createConfigurationNode } from "../nodes/config-node.js";
import { createCronConfigTools } from "../nodes/config-tools.js";
import type { RuntimeSchedulerService } from "../cron/runtime-scheduler-service.js";
import type { SupabaseMcpSession } from "../packages/finance-server/src/index.js";
import { createFinanceTools, createFinanceNode } from "../nodes/finance-node/index.js";
import { createObsidianNode } from "../nodes/obsidian/obsidian.js";
import { createObsidianTools } from "../nodes/obsidian/index.js";
import { createSupervisorNode } from "../nodes/supervisor-node.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "../state.js";

export type WorkflowGraphConfig = Pick<AppConfig, "obsidianVaultPath" | "appTimezone" | "cronJobsFilePath"> & {
  supabaseSession?: SupabaseMcpSession;
  runtimeScheduler?: RuntimeSchedulerService;
};

const isLlmConnector = (value: unknown): value is ILLMConnector => {
  return Boolean(
    value
    && typeof value === "object"
    && "getModel" in value
    && typeof (value as ILLMConnector).getModel === "function"
    && "bindRoutingTools" in value
    && typeof (value as ILLMConnector).bindRoutingTools === "function",
  );
};

export const createWorkflowGraph = (
  supervisorLlmConnector: ILLMConnector,
  obsidianLlmConnector: ILLMConnector,
  financeLlmConnector: ILLMConnector,
  configLlmConnectorOrConfig: ILLMConnector | WorkflowGraphConfig,
  maybeConfig?: WorkflowGraphConfig,
) => {
  const configLlmConnector = isLlmConnector(configLlmConnectorOrConfig)
    ? configLlmConnectorOrConfig
    : obsidianLlmConnector;
  const config = isLlmConnector(configLlmConnectorOrConfig)
    ? maybeConfig!
    : configLlmConnectorOrConfig;

  const supervisorNode = createSupervisorNode(supervisorLlmConnector);
  const cronJobRepository = createCronJobRepository(process.cwd(), path.relative(process.cwd(), config.cronJobsFilePath));
  const configurationTools = createCronConfigTools(cronJobRepository);
  const configurationNode = createConfigurationNode(configLlmConnector.getModel(), configurationTools, {
    repository: cronJobRepository,
    runtimeScheduler: config.runtimeScheduler,
  });
  const configurationToolsNode = new ToolNode(configurationTools);
  const obsidianNode = createObsidianNode(obsidianLlmConnector, config.obsidianVaultPath);
  const obsidianToolsNode = new ToolNode(createObsidianTools(config.obsidianVaultPath));
  const memory = new MemorySaver();

  // Create finance node and tools: if supabaseSession is provided, set up tool execution loop
  const financeTools = config.supabaseSession ? createFinanceTools(config.supabaseSession) : undefined;
  const financeToolsNode = financeTools ? new ToolNode(financeTools) : undefined;
  
  const financeNode = config.supabaseSession
    ? createFinanceNode(financeLlmConnector.getModel(), financeTools!)
    : async (_state: AgentState) => ({
        messages: [new AIMessage("Finance sync not configured. Enable ENABLE_FINANCE_SYNC and provide Supabase credentials.")],
      });

  // Build graph - add all nodes upfront
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("configuration", configurationNode)
    .addNode("configurationTools", configurationToolsNode)
    .addNode("finance", financeNode)
    .addNode("obsidian", obsidianNode)
    .addNode("obsidianTools", obsidianToolsNode);

  // Add financeTools node if finance sync is configured
  if (financeToolsNode) {
    (graph as any).addNode("financeTools", financeToolsNode);
  }

  // Add supervisor edges
  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Finance_SG: "finance",
        Obsidian_SG: "obsidian",
        Config_SG: "configuration",
        FINISH: END,
      } satisfies Record<RouteName, "finance" | "obsidian" | "configuration" | typeof END>,
    );

  graph.addConditionalEdges("configuration", (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "configurationTools";
    }

    return "supervisor";
  });
  graph.addEdge("configurationTools", "configuration");

  // Add finance tool loop if session is configured
  if (financeToolsNode) {
    // TypeScript doesn't track conditional node additions well, so we use type assertions
    (graph as any).addConditionalEdges("finance", (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "financeTools";
      }
      return "supervisor";
    });
    (graph as any).addEdge("financeTools", "finance");
  } else {
    graph.addEdge("finance", "supervisor");
  }

  // Add obsidian tool loop
  graph.addConditionalEdges("obsidian", (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "obsidianTools";
    }

    // Legacy fallback guard for Gemini function call format
    if (lastMessage && typeof lastMessage === "object" && "additional_kwargs" in lastMessage) {
      if ((lastMessage as any).additional_kwargs?.functionCall) return "obsidianTools";
    }

    return "supervisor";
  });
  graph.addEdge("obsidianTools", "obsidian");

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};