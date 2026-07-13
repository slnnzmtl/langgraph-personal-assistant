import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";
import path from "node:path";

import type { AppConfig } from "../config.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import { createCronJobRepository } from "../cron/cron-job-repository.js";
import { createConfigurationNode, createCronConfigTools } from "../nodes/configurator/index.js";
import type { RuntimeSchedulerService } from "../cron/runtime-scheduler-service.js";
import type { SupabaseMcpSession } from "../mcp/supabase/index.js";
import { createFinanceSubgraphWrapper } from "../nodes/financist/subgraph.js";
import { createObsidianSubgraphWrapper } from "../nodes/obsidian/subgraph.js";
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
  const memory = new MemorySaver();

  // Create Finance and Obsidian sub-graph wrappers
  const financeSubgraphWrapper = config.supabaseSession
    ? createFinanceSubgraphWrapper(config.supabaseSession, financeLlmConnector.getModel())
    : async (_state: AgentState) => ({
        messages: [new AIMessage("Finance sync not configured. Enable ENABLE_FINANCE_SYNC and provide Supabase credentials.")],
      });

  const obsidianSubgraphWrapper = createObsidianSubgraphWrapper(obsidianLlmConnector, config.obsidianVaultPath);

  // Build graph - add all nodes upfront
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("configuration", configurationNode)
    .addNode("configurationTools", configurationToolsNode)
    .addNode("Finance_SG", financeSubgraphWrapper)
    .addNode("Obsidian_SG", obsidianSubgraphWrapper);

  // Add supervisor edges
  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Finance_SG: "Finance_SG",
        Obsidian_SG: "Obsidian_SG",
        Config_SG: "configuration",
        FINISH: END,
      } satisfies Record<RouteName, "Finance_SG" | "Obsidian_SG" | "configuration" | typeof END>,
    );

  // Finance and Obsidian sub-graphs return directly to supervisor
  graph.addEdge("Finance_SG", "supervisor");
  graph.addEdge("Obsidian_SG", "supervisor");

  graph.addConditionalEdges("configuration", (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "configurationTools";
    }

    return "supervisor";
  });
  graph.addEdge("configurationTools", "configuration");

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};