import { Telegraf } from "telegraf";

import type { CronExecutionReporter, CronJobResult, CronJobRun } from "@personal-assistant/supervisor-framework";
import { formatTelegramMarkdownV2, splitMessage } from "./telegram-adapter.js";

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
    for (const chunk of splitMessage(text)) {
      try {
        await telegram.sendMessage(chatId, formatTelegramMarkdownV2(chunk), { parse_mode: "MarkdownV2" });
      } catch (error) {
        const isParseError =
          error instanceof Error &&
          error.message.includes("can't parse entities");

        if (isParseError) {
          await telegram.sendMessage(chatId, chunk);
        } else {
          throw error;
        }
      }
    }
  };

  return {
    async onStart(job) {
      await send(`${formatJobHeader(job)} - Started`);
    },

    async onProgress(job, message) {
      await send(`${formatJobHeader(job)} - In Progress\n${message}`);
    },

    async onSuccess(job) {
      await send(`${formatJobHeader(job)}\n${summarizeResult(job)}`);
    },

    async onError(error, job) {
      await send(`${formatJobHeader(job)} - Failed\nError: ${error instanceof Error ? error.message : String(error)}`);
    },
  };
};
