import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { IFileSender } from "./telegram/file-sender.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "./cron-triggers.js";
import { createAssistant } from "./core/create-assistant.js";
import type { RuntimeAgentRepository } from "./core/agents/repository.js";
import type { PolicyRegistry } from "./core/policies/registry.js";
import type { PromptResolver } from "./core/agents/prompt-resolver.js";
import type { RuntimeToolBundleDeps } from "./runtime-agents/tool-bundles.js";
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
  promptResolver?: PromptResolver;
  policyRegistry?: PolicyRegistry;
  bundleDeps?: RuntimeToolBundleDeps;
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
  promptResolver,
  policyRegistry,
  bundleDeps,
}: CreateWorkflowGraphInput) => {
  if (!promptResolver || !policyRegistry || !bundleDeps) {
    throw new Error("createWorkflowGraph requires promptResolver, policyRegistry, and bundleDeps.");
  }

  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return createAssistant({
    supervisorLlm,
    models,
    defaultModelKey,
    runtimeAgentRepository,
    cronJobRepository,
    ...(runtimeCron ? { runtimeCron } : {}),
    bundleDeps,
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
