import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import type { CronJobRepository, RuntimeCronService } from "./cron/types.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "./cron-triggers.js";
import type { RuntimeAgentDefinition } from "./core/types/agent.js";
import { createAssistant } from "./core/create-assistant.js";
import type { RuntimeAgentRepository } from "./core/agents/repository.js";
import type { PolicyRegistry } from "./core/policies/registry.js";
import type { LoadPromptByKey } from "./core/agents/resolve-system-prompt.js";
import type { RuntimeToolBundleDeps } from "./runtime-agents/tool-bundles.js";
import { loadSupervisorSystemPrompt } from "./prompts/load-system-prompt.js";

export type CreateWorkflowGraphInput = {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  runtimeAgents: RuntimeAgentDefinition[];
  cronTargetAgentIds: readonly string[];
  cronJobRepository: CronJobRepository;
  runtimeAgentRepository: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  defaultModelKey?: string;
  messageHistoryMaxTokens: number;
  loadPromptByKey: LoadPromptByKey;
  policyRegistry: PolicyRegistry;
  bundleDeps: RuntimeToolBundleDeps;
};

export const createWorkflowGraph = ({
  supervisorLlm,
  models,
  runtimeAgents,
  cronTargetAgentIds,
  cronJobRepository,
  runtimeAgentRepository,
  runtimeCron,
  defaultModelKey = "generic",
  messageHistoryMaxTokens,
  loadPromptByKey,
  policyRegistry,
  bundleDeps,
}: CreateWorkflowGraphInput) => {
  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return createAssistant({
    supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository,
    cronJobRepository,
    ...(runtimeCron ? { runtimeCron } : {}),
    bundleDeps,
    loadPromptByKey,
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) => cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    messageHistoryMaxTokens,
  });
};
