import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";
import { resolveCronTriggerRoute, SUPERVISE_CRON_ROUTE } from "./cron-triggers.js";
import { createAssistant } from "./core/create-assistant.js";
import type { RuntimeAgentRepository } from "./core/agents/repository.js";
import { createAppExecutionKit } from "./app/register-defaults.js";
import {
  loadSupervisorSystemPrompt,
} from "./prompts/load-system-prompt.js";

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
  const { promptResolver, policyRegistry } = createAppExecutionKit();

  return createAssistant({
    supervisorLlm: supervisorLlmConnector,
    models: {
      generic: obsidianLlmConnector.getModel(),
      finance: financeLlmConnector.getModel(),
      obsidian: obsidianLlmConnector.getModel(),
      configuration: configLlmConnector.getModel(),
    },
    defaultModelKey: "generic",
    runtimeAgentRepository: config.runtimeAgentRepository,
    cronJobRepository: config.cronJobRepository,
    ...(config.runtimeCron ? { runtimeCron: config.runtimeCron } : {}),
    bundleDeps: {
      obsidianVaultPath: config.obsidianVaultPath,
      obsidianLlmConnector,
      ...(config.fileSender ? { fileSender: config.fileSender } : {}),
      ...(config.supabaseSession ? { supabaseSession: config.supabaseSession } : {}),
    },
    promptResolver,
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) => resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    graphName: "personal-assistant-phase-1",
  });
};
