import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "./cron-triggers.js";
import { createAssistant } from "./core/create-assistant.js";
import type { RuntimeAgentRepository } from "./core/agents/repository.js";
import { createAppExecutionKit } from "./app/register-defaults.js";
import { createRuntimeToolBundleDeps } from "./runtime-agents/tool-bundles.js";
import { loadSupervisorSystemPrompt } from "./prompts/load-system-prompt.js";

export type WorkflowGraphConfig = {
  obsidianVaultPath: string;
  cronJobRepository: CronJobRepository;
  runtimeAgentRepository: RuntimeAgentRepository;
  supabaseSession?: SupabaseMcpSession;
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
};

export type CreateWorkflowGraphInput = WorkflowGraphConfig & {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  executors: Iterable<string>;
  cronTargetAgentIds: readonly string[];
  defaultModelKey?: string;
  messageHistoryMaxTokens: number;
};

export const createWorkflowGraph = ({
  supervisorLlm,
  models,
  executors,
  cronTargetAgentIds,
  defaultModelKey = "generic",
  obsidianVaultPath,
  cronJobRepository,
  runtimeAgentRepository,
  runtimeCron,
  fileSender,
  supabaseSession,
  messageHistoryMaxTokens,
}: CreateWorkflowGraphInput) => {
  const { promptResolver, policyRegistry } = createAppExecutionKit(executors);
  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return createAssistant({
    supervisorLlm,
    models,
    defaultModelKey,
    runtimeAgentRepository,
    cronJobRepository,
    ...(runtimeCron ? { runtimeCron } : {}),
    bundleDeps: createRuntimeToolBundleDeps(obsidianVaultPath, {
      cronTargetAgentIds,
      cronJobRepository,
      runtimeAgentRepository,
      ...(fileSender ? { fileSender } : {}),
      ...(supabaseSession ? { supabaseSession } : {}),
    }),
    promptResolver,
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) => cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    messageHistoryMaxTokens,
  });
};
