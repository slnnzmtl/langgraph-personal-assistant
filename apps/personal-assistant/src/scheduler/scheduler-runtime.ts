import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Telegram } from "telegraf";

import type { AppConfig } from "../config.js";
import { createTelegramCronReporter } from "../telegram/telegram-cron-reporter.js";
import {
  createCronRunner,
  createLazyCronService,
  createRuntimeCronService,
  startCronBootstrap,
  type CronJobRepository,
  type CronJobRun,
} from "@personal-assistant/supervisor-framework";

export type LazyCronService = ReturnType<typeof createLazyCronService>;

export const createLazyCron = (): LazyCronService => createLazyCronService();

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

export type StartSchedulerRuntimeOptions = {
  getGraph: () => GraphInvoker;
  summaryModel: BaseChatModel;
  config: AppConfig;
  runtimeCron: LazyCronService;
  cronJobRepository: CronJobRepository;
  telegram: Telegram;
  cronTargetAgentIds?: readonly string[];
  schedulerEnabled?: boolean;
};

export const startSchedulerRuntime = async (options: StartSchedulerRuntimeOptions): Promise<void> => {
  const { getGraph, summaryModel, config, runtimeCron, cronJobRepository, telegram } = options;

  const onJobError = (error: unknown, context: CronJobRun): void => {
    console.error(`[Cron] Job failed: ${context.jobName}`, error);
  };

  const cronReporter = createTelegramCronReporter({
    telegram,
    chatId: config.allowedTelegramChatId,
  });

  const cronRunner = createCronRunner({
    getGraph,
    summaryModel,
    onError: onJobError,
    reporter: cronReporter,
  });

  const runtimeCronService = createRuntimeCronService({
    runner: async (job) => {
      await cronRunner.run(job);
    },
    timezone: config.appTimezone,
  });

  runtimeCron.setService(runtimeCronService);

  await startCronBootstrap({
    repository: cronJobRepository,
    config: {
      schedulerEnabled: options.schedulerEnabled ?? config.schedulerEnabled,
    },
    runtimeCron: runtimeCronService,
    ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  });
};
