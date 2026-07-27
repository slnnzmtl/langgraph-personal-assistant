// Telegram bot process entry — distinct from src/cron/ scheduler entry.
import { Telegraf } from "telegraf";

import { createSupervisorSystem } from "./app/composition/create-supervisor-system.js";
import { watchRuntimeAgentDefinitions } from "./app/composition/runtime-agent-watcher.js";
import type { AppConfig } from "./config.js";
import type { RuntimeAgentWatcher } from "./app/composition/runtime-agent-watcher.js";
import type { SupervisorGraphRef } from "./app/composition/supervisor-graph-ref.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";

export type PersonalAssistantApp = {
  config: AppConfig;
  bot: Telegraf;
  graphRef: SupervisorGraphRef;
  agentWatcher: RuntimeAgentWatcher;
  telegramAdapter: TelegramAdapter;
};

export const createApp = async (config: AppConfig): Promise<PersonalAssistantApp> => {
  const bot = new Telegraf(config.telegramBotToken);
  const fileSender = new TelegramFileSender(bot.telegram);
  const system = await createSupervisorSystem(config, { fileSender });
  const agentWatcher = watchRuntimeAgentDefinitions(config.runtimeAgentsFilePath, system.graphRef);
  const telegramAdapter = new TelegramAdapter(system.graphRef, config, bot, fileSender);

  return {
    config,
    bot,
    graphRef: system.graphRef,
    agentWatcher,
    telegramAdapter,
  };
};

export const launchApp = async (app: PersonalAssistantApp): Promise<void> => {
  await app.telegramAdapter.launch();
  console.log("Telegram adapter launched in long-polling mode.");
};
