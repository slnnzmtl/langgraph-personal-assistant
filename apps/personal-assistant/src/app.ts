import { Telegraf } from "telegraf";

import {
  watchRuntimeAgentDefinitions,
  type RuntimeAgentWatcher,
} from "@personal-assistant/supervisor-framework";
import {
  createSupervisorSystem,
  type PersonalSupervisorSystem,
} from "./composition/create-supervisor-system.js";
import type { AppConfig } from "./config.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";

export type PersonalAssistantApp = {
  config: AppConfig;
  bot: Telegraf;
  system: PersonalSupervisorSystem;
  agentWatcher: RuntimeAgentWatcher;
  telegramAdapter: TelegramAdapter;
  shutdown(): Promise<void>;
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
    system,
    agentWatcher,
    telegramAdapter,
    shutdown: async () => {
      agentWatcher.close();
      bot.stop();
      await system.shutdownAdapters();
    },
  };
};

export const launchApp = async (app: PersonalAssistantApp): Promise<void> => {
  await app.telegramAdapter.launch();
  console.log("Telegram adapter launched in long-polling mode.");
};
