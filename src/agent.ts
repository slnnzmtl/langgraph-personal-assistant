import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import { createRuntimeAgentDispatcher } from "./runtime-agents/dispatch.js";
import { createRuntimeAgentExecutionContext } from "./runtime-agents/execution-context.js";
import { createSupervisorNode } from "./nodes/supervisor-node.js";
import type { RuntimeAgentRepository } from "./runtime-agents/repository.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "./state.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";

export type WorkflowGraphConfig = {
  obsidianVaultPath: string;
  cronJobRepository: CronJobRepository;
  runtimeAgentRepository: RuntimeAgentRepository;
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
  const memory = new MemorySaver();
  const supervisorNode = createSupervisorNode(supervisorLlmConnector, {
    runtimeAgentRepository: config.runtimeAgentRepository,
  });

  const runtimeExecutionContext = createRuntimeAgentExecutionContext({
    genericModel: obsidianLlmConnector.getModel(),
    financeModel: financeLlmConnector.getModel(),
    obsidianLlmConnector,
    configurationModel: configLlmConnector.getModel(),
    repository: config.runtimeAgentRepository,
    cronJobRepository: config.cronJobRepository,
    ...(config.runtimeCron ? { runtimeCron: config.runtimeCron } : {}),
    obsidianVaultPath: config.obsidianVaultPath,
    ...(config.fileSender ? { fileSender: config.fileSender } : {}),
    ...(config.supabaseSession ? { supabaseSession: config.supabaseSession } : {}),
  });

  const runtimeAgentDispatcher = createRuntimeAgentDispatcher(runtimeExecutionContext);

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("Runtime_SG", runtimeAgentDispatcher);

  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Runtime_SG: "Runtime_SG",
        FINISH: END,
      } satisfies Record<RouteName, "Runtime_SG" | typeof END>,
    );

  graph.addEdge("Runtime_SG", "supervisor");

  return graph.compile({ checkpointer: memory, name: "personal-assistant-phase-1" });
};
