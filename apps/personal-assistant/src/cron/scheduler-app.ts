import { Telegraf } from "telegraf";

import { createSupervisorSystem } from "../app/composition/create-supervisor-system.js";
import type { AppConfig } from "../config.js";
import { createLazyCron, startCron, type LazyCronService } from "./cron-startup.js";
import { watchCronJobDefinitions, type CronJobWatcher } from "./cron-job-watcher.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import type { RuntimeCronService } from "./types.js";
import type { CompiledSupervisorGraph } from "@personal-assistant/supervisor-framework";
import type { GeminiConnector } from "../connectors/llm-connector.js";

export type SchedulerApp = {
  config: AppConfig;
  graph: CompiledSupervisorGraph;
  cronJobRepository: CronJobRepository;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  lazyCron: LazyCronService;
  runtimeCron: RuntimeCronService;
  jobWatcher: CronJobWatcher;
};

export const createSchedulerApp = async (config: AppConfig): Promise<SchedulerApp> => {
  const lazyCron = createLazyCron();
  const system = await createSupervisorSystem(config, { runtimeCron: lazyCron });

  const bot = new Telegraf(config.telegramBotToken);

  await startCron({
    graph: system.graph,
    summaryModel: system.supervisorConnector.getModel(),
    config,
    lazyCron,
    cronJobRepository: system.cronJobRepository,
    telegram: bot.telegram,
    cronTargetAgentIds: system.cronTargetAgentIds,
    schedulerEnabled: config.schedulerEnabled,
  });

  const jobWatcher = watchCronJobDefinitions(config.cronJobsFilePath, {
    repository: system.cronJobRepository,
    runtimeCron: lazyCron,
  });

  return {
    config: system.config,
    graph: system.graph,
    cronJobRepository: system.cronJobRepository,
    cronTargetAgentIds: system.cronTargetAgentIds,
    supervisorConnector: system.supervisorConnector,
    lazyCron,
    runtimeCron: lazyCron,
    jobWatcher,
  };
};

export const waitForProcessShutdown = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const shutdown = (): void => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

export const launchScheduler = async (app: SchedulerApp): Promise<void> => {
  console.log("Cron scheduler running. Watching for job definition changes.");

  await waitForProcessShutdown();
  app.jobWatcher.close();
};
