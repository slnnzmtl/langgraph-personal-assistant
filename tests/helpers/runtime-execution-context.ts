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

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
};

export type RuntimeAgentExecutionContext = CoreRuntimeAgentExecutionContext & {
  obsidianLlmConnector: ILLMConnector;
  bundleDeps: RuntimeToolBundleDeps;
  models: {
    generic: BaseChatModel;
    finance: BaseChatModel;
    obsidian: BaseChatModel;
    configuration: BaseChatModel;
  };
};

export type CreateRuntimeAgentExecutionContextInput = {
  genericModel: BaseChatModel;
  financeModel: BaseChatModel;
  obsidianLlmConnector: ILLMConnector;
  configurationModel: BaseChatModel;
  repository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  promptResolver?: CoreRuntimeAgentExecutionContext["promptResolver"];
  policyRegistry?: CoreRuntimeAgentExecutionContext["policyRegistry"];
};

export const createRuntimeAgentExecutionContext = (
  input: CreateRuntimeAgentExecutionContextInput,
): RuntimeAgentExecutionContext => {
  const { promptResolver, policyRegistry } = input.promptResolver && input.policyRegistry
    ? { promptResolver: input.promptResolver, policyRegistry: input.policyRegistry }
    : createAppExecutionKit();

  const coreContext = createCoreExecutionContext({
    models: {
      generic: input.genericModel,
      finance: input.financeModel,
      obsidian: input.obsidianLlmConnector.getModel(),
      configuration: input.configurationModel,
    },
    defaultModelKey: "generic",
    repository: input.repository,
    cronJobRepository: input.cronJobRepository,
    ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
    bundleDeps: {
      obsidianVaultPath: input.obsidianVaultPath,
      obsidianLlmConnector: input.obsidianLlmConnector,
      ...(input.fileSender ? { fileSender: input.fileSender } : {}),
      ...(input.supabaseSession ? { supabaseSession: input.supabaseSession } : {}),
    },
    promptResolver,
    policyRegistry,
  });

  return {
    ...coreContext,
    obsidianLlmConnector: input.obsidianLlmConnector,
    bundleDeps: coreContext.bundleDeps as RuntimeToolBundleDeps,
    models: {
      generic: resolveModel(coreContext, "generic"),
      finance: resolveModel(coreContext, "finance"),
      obsidian: resolveModel(coreContext, "obsidian"),
      configuration: resolveModel(coreContext, "configuration"),
    },
  };
};

export { resolveModel };
