import cron from "node-cron";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Telegram } from "telegraf";

import type { AppConfig } from "../config.js";
import { createTelegramCronReporter } from "../telegram/telegram-cron-reporter.js";
import { startCronBootstrap } from "./cron-bootstrap.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import { createLazyCronService, createRuntimeCronService } from "./runtime-cron-service.js";
import { createCronRunner, type CronJobRun } from "./cron-runner.js";

export type LazyCronService = ReturnType<typeof createLazyCronService>;

export const createLazyCron = (): LazyCronService => createLazyCronService();

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

export type StartCronOptions = {
  graph: GraphInvoker;
  summaryModel: BaseChatModel;
  config: AppConfig;
  lazyCron: LazyCronService;
  cronJobRepository: CronJobRepository;
  telegram: Telegram;
};

export const startCron = async (options: StartCronOptions): Promise<void> => {
  const { graph, summaryModel, config, lazyCron, cronJobRepository, telegram } = options;

  const onJobError = (error: unknown, context: CronJobRun): void => {
    console.error(`[Cron] Job failed: ${context.jobName}`, error);
  };

  const cronReporter = createTelegramCronReporter({
    telegram,
    chatId: config.allowedTelegramUserId,
  });

  const cronRunner = createCronRunner({
    graph,
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

  lazyCron.setService(runtimeCronService);

  await startCronBootstrap({
    repository: cronJobRepository,
    config: {
      appTimezone: config.appTimezone,
      schedulerEnabled: config.schedulerEnabled,
    },
    runner: cronRunner,
    schedule: cron.schedule.bind(cron),
  });
};
