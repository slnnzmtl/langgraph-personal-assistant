import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import { createConfigurationNode, createCronConfigTools } from "./nodes/configurator/index.js";
import { createFinanceSubgraphWrapper } from "./nodes/finance/graph.js";
import { createObsidianSubgraphWrapper } from "./nodes/obsidian/graph.js";
import { createSupervisorNode } from "./nodes/supervisor-node.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "./tools/routing.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "./state.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";

export type WorkflowGraphConfig = {
  obsidianVaultPath: string;
  cronJobRepository: CronJobRepository;
  supabaseSession?: SupabaseMcpSession;
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
  configLlmConnector?: ILLMConnector;
};

export const createWorkflowGraph = (
  supervisorLlmConnector: ILLMConnector,
  obsidianLlmConnector: ILLMConnector,
  financeLlmConnector: ILLMConnector,
  config: WorkflowGraphConfig,
) => {
  const configLlmConnector = config.configLlmConnector ?? obsidianLlmConnector;
  const configurationTools = createCronConfigTools(config.cronJobRepository);
  const configurationNode = createConfigurationNode(configLlmConnector.getModel(), configurationTools, {
    repository: config.cronJobRepository,
    runtimeCron: config.runtimeCron,
  });
  const configurationToolsNode = new ToolNode(configurationTools);
  const memory = new MemorySaver();
  const supervisorNode = createSupervisorNode(supervisorLlmConnector);

  const financeSubgraphWrapper = config.supabaseSession
    ? createFinanceSubgraphWrapper(config.supabaseSession, financeLlmConnector.getModel())
    : async (_state: AgentState) => ({
        messages: [new AIMessage("Supabase session is not configured.")],
      });

  const obsidianSubgraphWrapper = createObsidianSubgraphWrapper(
    obsidianLlmConnector,
    config.obsidianVaultPath,
    config.fileSender,
  );

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("configuration", configurationNode)
    .addNode("configurationTools", configurationToolsNode)
    .addNode("Finance_SG", financeSubgraphWrapper)
    .addNode("Obsidian_SG", obsidianSubgraphWrapper);

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

  graph.addEdge("Finance_SG", "supervisor");
  graph.addEdge("Obsidian_SG", "supervisor");

  graph.addConditionalEdges("configuration", (state: AgentState) => {
    if (hasPendingToolCalls(state.messages) || lastMessageRequestsTools(state.messages)) {
      return "configurationTools";
    }

    return "supervisor";
  });
  graph.addConditionalEdges("configurationTools", (state: AgentState) => {
    if (hasPendingToolCalls(state.messages)) {
      return "configurationTools";
    }

    return "configuration";
  });

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};
