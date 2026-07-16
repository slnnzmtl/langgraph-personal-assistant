import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import type { IFileSender } from "../../src/telegram/file-sender.js";
import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  resolveModel,
  type RuntimeAgentExecutionContext as CoreRuntimeAgentExecutionContext,
} from "../../src/core/execution/context.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/defaults.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/runtime-agent-catalog.js";

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
};

export type RuntimeAgentExecutionContext = CoreRuntimeAgentExecutionContext & {
  bundleDeps: RuntimeToolBundleDeps;
};

export type CreateRuntimeAgentExecutionContextInput = {
  models?: Record<string, BaseChatModel>;
  defaultModel?: BaseChatModel;
  repository?: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
  promptResolver?: CoreRuntimeAgentExecutionContext["promptResolver"];
  policyRegistry?: CoreRuntimeAgentExecutionContext["policyRegistry"];
};

export const createRuntimeAgentExecutionContext = (
  input: CreateRuntimeAgentExecutionContextInput,
): RuntimeAgentExecutionContext => {
  const runtimeAgents = buildDefaultRuntimeAgents();
  const defaultModelKey = "generic";
  const defaultModel = input.defaultModel ?? input.models?.[defaultModelKey];

  if (!defaultModel) {
    throw new Error("createRuntimeAgentExecutionContext requires defaultModel or models.generic");
  }

  const models = input.models ?? Object.fromEntries(
    [...deriveModelKeys(runtimeAgents, defaultModelKey)].map((modelKey) => [modelKey, defaultModel]),
  );

  const cronTargetAgentIds = input.cronTargetAgentIds ?? deriveCronTargetAgentIds(runtimeAgents);
  const executors = deriveExecutors(runtimeAgents);
  const { promptResolver, policyRegistry } = input.promptResolver && input.policyRegistry
    ? { promptResolver: input.promptResolver, policyRegistry: input.policyRegistry }
    : createAppExecutionKit(executors);

  const coreContext = createCoreExecutionContext({
    models,
    defaultModelKey,
    repository: input.repository ?? {
      loadAgents: async () => runtimeAgents,
      getAgent: async (id) => runtimeAgents.find((agent) => agent.id === id),
      saveAgents: async () => {},
      createAgent: async () => {
        throw new Error("Not implemented in test fake.");
      },
      updateAgent: async () => {
        throw new Error("Not implemented in test fake.");
      },
      deleteAgent: async () => {
        throw new Error("Not implemented in test fake.");
      },
    },
    cronJobRepository: input.cronJobRepository,
    ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
    bundleDeps: {
      obsidianVaultPath: input.obsidianVaultPath,
      cronTargetAgentIds,
      ...(input.fileSender ? { fileSender: input.fileSender } : {}),
      ...(input.supabaseSession ? { supabaseSession: input.supabaseSession } : {}),
    },
    promptResolver,
    policyRegistry,
  });

  return {
    ...coreContext,
    bundleDeps: coreContext.bundleDeps as RuntimeToolBundleDeps,
  };
};

export { resolveModel };
