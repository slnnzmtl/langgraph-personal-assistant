import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { CronJobRepository, RuntimeCronService } from "../cron/types.js";
import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { IFileSender } from "../telegram/file-sender.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { RuntimeAgentRepository } from "./repository.js";
import type { RuntimeToolBundleDeps } from "./tool-bundles.js";

export type RuntimeAgentExecutionContext = {
  models: {
    generic: BaseChatModel;
    finance: BaseChatModel;
    obsidian: BaseChatModel;
    configuration: BaseChatModel;
  };
  obsidianLlmConnector: ILLMConnector;
  repository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps: RuntimeToolBundleDeps;
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
};

export const createRuntimeAgentExecutionContext = (
  input: CreateRuntimeAgentExecutionContextInput,
): RuntimeAgentExecutionContext => ({
  models: {
    generic: input.genericModel,
    finance: input.financeModel,
    obsidian: input.obsidianLlmConnector.getModel(),
    configuration: input.configurationModel,
  },
  obsidianLlmConnector: input.obsidianLlmConnector,
  repository: input.repository,
  cronJobRepository: input.cronJobRepository,
  ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
  bundleDeps: {
    obsidianVaultPath: input.obsidianVaultPath,
    ...(input.fileSender ? { fileSender: input.fileSender } : {}),
    ...(input.supabaseSession ? { supabaseSession: input.supabaseSession } : {}),
  },
});
