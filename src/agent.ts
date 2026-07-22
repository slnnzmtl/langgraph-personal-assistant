// Deployment-specific graph wiring: cron triggers, prompt logging, supervisor prompt.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "./connectors/llm-connector.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "./cron-triggers.js";
import type { RuntimeAgentDefinition } from "./core/types/agent.js";
import { createAssistant } from "./core/create-assistant.js";
import type { RuntimeAgentRepository } from "./core/agents/repository.js";
import type { PolicyRegistry } from "./core/policies/registry.js";
import type { LoadPromptByKey } from "./core/agents/resolve-system-prompt.js";
import type { PromptLoggingHook } from "./core/ports/prompt-logging.js";
import type { CapabilityDeps } from "./runtime-agents/builtin-capabilities.js";
import { loadSupervisorSystemPrompt } from "./prompts/load-system-prompt.js";
import { defaultReplyUxConfig } from "./core/supervisor/reply-ux.js";
import { logSystemPromptInvocation } from "./logging/system-prompt-logger.js";

export type CreateWorkflowGraphInput = {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  runtimeAgents: RuntimeAgentDefinition[];
  cronTargetAgentIds: readonly string[];
  runtimeAgentRepository: RuntimeAgentRepository;
  defaultModelKey?: string;
  messageHistoryMaxTokens: number;
  loadPromptByKey: LoadPromptByKey;
  policyRegistry: PolicyRegistry;
  bundleDeps: CapabilityDeps;
  promptLogging?: PromptLoggingHook;
};

export const createWorkflowGraph = ({
  supervisorLlm,
  models,
  runtimeAgents,
  cronTargetAgentIds,
  runtimeAgentRepository,
  defaultModelKey = "generic",
  messageHistoryMaxTokens,
  loadPromptByKey,
  policyRegistry,
  bundleDeps,
  promptLogging = logSystemPromptInvocation,
}: CreateWorkflowGraphInput) => {
  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return createAssistant<CapabilityDeps>({
    supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository,
    bundleDeps,
    loadPromptByKey,
    policyRegistry,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    replyUx: defaultReplyUxConfig,
    promptLogging,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) => cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    messageHistoryMaxTokens,
  });
};
