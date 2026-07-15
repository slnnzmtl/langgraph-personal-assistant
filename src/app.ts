import { Telegraf } from "telegraf";

import { createWorkflowGraph } from "./agent.js";
import type { AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createLazyCron, startCron } from "./cron/cron-startup.js";
import { createCronJobRepositoryForConfig } from "./cron/cron-job-repository.js";
import { createRuntimeAgentRepositoryForConfig } from "./runtime-agents/repository.js";
import { ensureBuiltinRuntimeAgents } from "./runtime-agents/bootstrap.js";
import { setupSupabaseSession } from "./services/supabase.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";

export type PersonalAssistantApp = {
  config: AppConfig;
  bot: Telegraf;
  graph: ReturnType<typeof createWorkflowGraph>;
  telegramAdapter: TelegramAdapter;
};

export const createApp = async (config: AppConfig): Promise<PersonalAssistantApp> => {
  const bot = new Telegraf(config.telegramBotToken);
  const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
  const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
  const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

  const supabaseSession = await setupSupabaseSession(config);
  const cronJobRepository = createCronJobRepositoryForConfig(config.cronJobsFilePath);
  const runtimeAgentRepository = createRuntimeAgentRepositoryForConfig(config.runtimeAgentsFilePath);
  const fileSender = new TelegramFileSender(bot.telegram);
  const lazyCron = createLazyCron();

  await ensureBuiltinRuntimeAgents(runtimeAgentRepository, {
    financeAvailable: supabaseSession !== undefined,
  });

  const graph = createWorkflowGraph(supervisorConnector, obsidianConnector, financeConnector, {
    obsidianVaultPath: config.obsidianVaultPath,
    cronJobRepository,
    runtimeAgentRepository,
    runtimeCron: lazyCron,
    fileSender,
    ...(supabaseSession ? { supabaseSession } : {}),
  });

  await startCron({
    graph,
    summaryModel: supervisorConnector.getModel(),
    config,
    lazyCron,
    cronJobRepository,
    telegram: bot.telegram,
  });

  const telegramAdapter = new TelegramAdapter(graph, config, bot, fileSender);

  return {
    config,
    bot,
    graph,
    telegramAdapter,
  };
};

export const launchApp = async (app: PersonalAssistantApp): Promise<void> => {
  await app.telegramAdapter.launch();
  console.log("Telegram adapter launched in long-polling mode.");
};
