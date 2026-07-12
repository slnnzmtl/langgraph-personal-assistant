import { Telegraf } from "telegraf";

import type { SchedulerExecutionReporter, SchedulerJobResult, SchedulerJobRun } from "../cron/scheduler-runner.js";

type TelegramCronReporterOptions = {
  telegramBotToken: string;
  chatId: string | number;
};

const formatJobHeader = (job: SchedulerJobRun): string => `Cron job: ${job.jobName}`;

const summarizeResult = (job: SchedulerJobResult): string => {
  if (!job.summary?.trim()) {
    throw new Error(`Missing summary for completed cron job: ${job.jobName}`);
  }
  return job.summary.trim();
};

export const createTelegramCronReporter = (options: TelegramCronReporterOptions): SchedulerExecutionReporter => {
  const telegram = new Telegraf(options.telegramBotToken).telegram;

  const send = async (text: string): Promise<void> => {
    await telegram.sendMessage(options.chatId, text);
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