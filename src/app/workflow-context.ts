import { createWorkflowGraph } from "../agent.js";
import type { AppConfig } from "../config.js";
import { GeminiConnector } from "../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../cron/cron-job-repository.js";
import type { RuntimeCronService } from "../cron/types.js";
import { createRuntimeAgentRepositoryForConfig } from "../core/agents/repository.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import { ensureBuiltinRuntimeAgents } from "../runtime-agents/bootstrap.js";
import { applyLocalModuleAvailability } from "../runtime-agents/builtin-domains.js";
import { setupSupabaseSession } from "../services/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import { buildModelRegistry } from "./model-registry.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "./runtime-agent-catalog.js";

export type WorkflowContext = {
  config: AppConfig;
  graph: ReturnType<typeof createWorkflowGraph>;
  cronJobRepository: ReturnType<typeof createCronJobRepositoryForConfig>;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  supabaseSession?: SupabaseMcpSession | undefined;
};

export type CreateWorkflowContextOptions = {
  runtimeCron?: RuntimeCronService | undefined;
  fileSender?: IFileSender | undefined;
};

export const createWorkflowContext = async (
  config: AppConfig,
  options: CreateWorkflowContextOptions = {},
): Promise<WorkflowContext> => {
  const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
  const supabaseSession = await setupSupabaseSession(config);
  const runtimeAgentRepository = createRuntimeAgentRepositoryForConfig(config.runtimeAgentsFilePath);

  const runtimeAgents = applyLocalModuleAvailability(
    await ensureBuiltinRuntimeAgents(runtimeAgentRepository),
    { supabaseAvailable: supabaseSession !== undefined },
  );

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const cronJobRepository = createCronJobRepositoryForConfig(config.cronJobsFilePath, cronTargetAgentIds);

  const defaultModelKey = "generic";
  const models = buildModelRegistry(config, deriveModelKeys(runtimeAgents, defaultModelKey));

  const graph = createWorkflowGraph({
    supervisorLlm: supervisorConnector,
    models,
    defaultModelKey,
    executors: deriveExecutors(runtimeAgents),
    cronTargetAgentIds,
    obsidianVaultPath: config.obsidianVaultPath,
    cronJobRepository,
    runtimeAgentRepository,
    ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
    ...(options.fileSender ? { fileSender: options.fileSender } : {}),
    ...(supabaseSession ? { supabaseSession } : {}),
    messageHistoryMaxTokens: config.messageHistoryMaxTokens,
  });

  return {
    config,
    graph,
    cronJobRepository,
    cronTargetAgentIds,
    supervisorConnector,
    ...(supabaseSession ? { supabaseSession } : {}),
  };
};
