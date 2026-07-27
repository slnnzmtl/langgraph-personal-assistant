// Telegram bot process entry — distinct from src/scheduler/ scheduler entry.
import { Telegraf } from "telegraf";

import {
  watchRuntimeAgentDefinitions,
  type RuntimeAgentWatcher,
} from "@personal-assistant/supervisor-framework";
import { createSupervisorSystem } from "./composition/create-supervisor-system.js";
import type { AppConfig } from "./config.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";

export type PersonalAssistantApp = {
  config: AppConfig;
  bot: Telegraf;
  agentWatcher: RuntimeAgentWatcher;
  telegramAdapter: TelegramAdapter;
};

export const createApp = async (config: AppConfig): Promise<PersonalAssistantApp> => {
  const bot = new Telegraf(config.telegramBotToken);
  const fileSender = new TelegramFileSender(bot.telegram);
  const system = await createSupervisorSystem(config, { fileSender });
  const agentWatcher = watchRuntimeAgentDefinitions(config.runtimeAgentsFilePath, system);
  const telegramAdapter = new TelegramAdapter(system, config, bot, fileSender);

  return {
    config,
    bot,
    agentWatcher,
    telegramAdapter,
  };
};

export const launchApp = async (app: PersonalAssistantApp): Promise<void> => {
  await app.telegramAdapter.launch();
  console.log("Telegram adapter launched in long-polling mode.");
};
