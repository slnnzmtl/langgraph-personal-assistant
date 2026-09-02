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
  type CronRunLedger,
} from "@personal-assistant/supervisor-framework";

export type LazyCronService = ReturnType<typeof createLazyCronService>;

export const createLazyCron = (): LazyCronService => createLazyCronService();

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

export type StartSchedulerRuntimeOptions = {
  getGraph: () => GraphInvoker;
  config: AppConfig;
  runtimeCron: LazyCronService;
  cronJobRepository: CronJobRepository;
  telegram: Telegram;
  cronRunLedger?: CronRunLedger;
  cronTargetAgentIds?: readonly string[];
  schedulerEnabled?: boolean;
};

export const startSchedulerRuntime = async (options: StartSchedulerRuntimeOptions): Promise<void> => {
  const { getGraph, config, runtimeCron, cronJobRepository, telegram } = options;

  const onJobError = (error: unknown, context: CronJobRun): void => {
    console.error(`[Cron] Job failed: ${context.jobName}`, error);
  };

  const cronReporter = createTelegramCronReporter({
    telegram,
    chatId: config.allowedTelegramChatId,
  });

  const cronRunner = createCronRunner({
    getGraph,
    onError: onJobError,
    reporter: cronReporter,
    ...(options.cronRunLedger ? { ledger: options.cronRunLedger } : {}),
  });

  const runtimeCronService = createRuntimeCronService({
    runner: async (job) => {
      await cronRunner.run(job);
    },
    timezone: config.appTimezone,
    ...(options.cronRunLedger
      ? {
          getLastRunAt: (jobName: string) => {
            const latest = options.cronRunLedger!.getLatestRun(jobName);
            if (!latest) {
              return undefined;
            }
            return new Date(latest.finishedAt ?? latest.startedAt);
          },
        }
      : {}),
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
