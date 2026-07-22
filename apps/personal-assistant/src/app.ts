// Telegram bot process entry — distinct from src/cron/ scheduler entry.
import { Telegraf } from "telegraf";

import { createSupervisorSystem } from "./app/composition/create-supervisor-system.js";
import type { AppConfig } from "./config.js";
import type { CompiledSupervisorGraph } from "@personal-assistant/supervisor-framework";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";

export type PersonalAssistantApp = {
  config: AppConfig;
  bot: Telegraf;
  graph: CompiledSupervisorGraph;
  telegramAdapter: TelegramAdapter;
};

export const createApp = async (config: AppConfig): Promise<PersonalAssistantApp> => {
  const bot = new Telegraf(config.telegramBotToken);
  const fileSender = new TelegramFileSender(bot.telegram);
  const { graph } = await createSupervisorSystem(config, { fileSender });
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
