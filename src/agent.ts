import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import { createConfigurationSubgraphWrapper, createCronConfigTools } from "./nodes/configuration/index.js";
import { createFinanceSubgraphWrapper } from "./nodes/finance/graph.js";
import { createObsidianSubgraphWrapper } from "./nodes/obsidian/index.js";
import { createSupervisorNode } from "./nodes/supervisor-node.js";
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
  const configurationSubgraphWrapper = createConfigurationSubgraphWrapper(
    configLlmConnector.getModel(),
    configurationTools,
    {
      repository: config.cronJobRepository,
      runtimeCron: config.runtimeCron,
    },
  );
  const memory = new MemorySaver();
  const supervisorNode = createSupervisorNode(supervisorLlmConnector);

  const financeSubgraphWrapper = createFinanceSubgraphWrapper(
    config.supabaseSession,
    financeLlmConnector.getModel(),
  );

  const obsidianSubgraphWrapper = createObsidianSubgraphWrapper(
    obsidianLlmConnector,
    config.obsidianVaultPath,
    config.fileSender,
  );

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("Config_SG", configurationSubgraphWrapper)
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
        Config_SG: "Config_SG",
        FINISH: END,
      } satisfies Record<RouteName, "Finance_SG" | "Obsidian_SG" | "Config_SG" | typeof END>,
    );

  graph.addEdge("Finance_SG", "supervisor");
  graph.addEdge("Obsidian_SG", "supervisor");
  graph.addEdge("Config_SG", "supervisor");

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};
