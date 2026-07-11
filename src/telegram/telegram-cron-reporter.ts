import { Telegraf } from "telegraf";

import type { SchedulerExecutionReporter, SchedulerJobResult, SchedulerJobRun } from "../cron/scheduler-runner.js";
import { extractMessageTextContent } from "../nodes/message-history.js";

type TelegramCronReporterOptions = {
  telegramBotToken: string;
  chatId: string | number;
};

const formatJobHeader = (job: SchedulerJobRun): string => `Cron job: ${job.jobName}`;

const summarizeResult = (job: SchedulerJobResult): string => {
  const lastMessage = job.messages?.at(-1);
  const lastMessageText = lastMessage ? extractMessageTextContent(lastMessage.content).trim() : "";

  if (!lastMessageText) {
    return "Completed without a textual result.";
  }

  return lastMessageText;
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