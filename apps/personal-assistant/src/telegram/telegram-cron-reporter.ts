import { Telegraf } from "telegraf";

import type { CronExecutionReporter, CronJobResult, CronJobRun } from "@personal-assistant/supervisor-framework";

type TelegramCronReporterOptions = {
  telegram: Telegraf["telegram"];
  chatId: string | number;
};

const formatJobHeader = (job: CronJobRun): string => `Cron job: ${job.jobName}`;

const summarizeResult = (job: CronJobResult): string => {
  if (!job.summary?.trim()) {
    throw new Error(`Missing summary for completed cron job: ${job.jobName}`);
  }
  return job.summary.trim();
};

export const createTelegramCronReporter = (options: TelegramCronReporterOptions): CronExecutionReporter => {
  const { telegram, chatId } = options;

  const send = async (text: string): Promise<void> => {
    await telegram.sendMessage(chatId, text);
  };

  return {
    async onStart(job) {
      await send(`${formatJobHeader(job)} - Started`);
    },

    async onProgress(job, message) {
      await send(`${formatJobHeader(job)} - In Progress\n${message}`);
    },

    async onSuccess(job) {
      await send(`${formatJobHeader(job)} - Completed\n${summarizeResult(job)}`);
    },

    async onError(error, job) {
      await send(`${formatJobHeader(job)} - Failed\nError: ${error instanceof Error ? error.message : String(error)}`);
    },
  };
};
