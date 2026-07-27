import { Telegraf } from "telegraf";

import { createSupervisorSystem } from "../composition/create-supervisor-system.js";
import {
  watchCronJobDefinitions,
  watchRuntimeAgentDefinitions,
  type CronJobRepository,
  type CronJobWatcher,
  type RuntimeAgentWatcher,
  type RuntimeCronService,
} from "@personal-assistant/supervisor-framework";
import type { AppConfig } from "../config.js";
import { createLazyCron, startSchedulerRuntime, type LazyCronService } from "./scheduler-runtime.js";
import type { GeminiConnector } from "../models/gemini-connector.js";

export type SchedulerApp = {
  config: AppConfig;
  cronJobRepository: CronJobRepository;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  runtimeCron: RuntimeCronService;
  jobWatcher: CronJobWatcher;
  agentWatcher: RuntimeAgentWatcher;
};

export const createSchedulerApp = async (config: AppConfig): Promise<SchedulerApp> => {
  const runtimeCron: LazyCronService = createLazyCron();
  const system = await createSupervisorSystem(config, { runtimeCron });

  const bot = new Telegraf(config.telegramBotToken);

  await startSchedulerRuntime({
    getGraph: () => system.getGraph(),
    summaryModel: system.supervisorConnector.getModel(),
    config,
    runtimeCron,
    cronJobRepository: system.cronJobRepository,
    telegram: bot.telegram,
    cronTargetAgentIds: system.cronTargetAgentIds,
    schedulerEnabled: config.schedulerEnabled,
  });

  const jobWatcher = watchCronJobDefinitions(config.cronJobsFilePath, {
    repository: system.cronJobRepository,
    runtimeCron,
  });
  const agentWatcher = watchRuntimeAgentDefinitions(config.runtimeAgentsFilePath, system);

  return {
    config: system.config,
    cronJobRepository: system.cronJobRepository,
    cronTargetAgentIds: system.cronTargetAgentIds,
    supervisorConnector: system.supervisorConnector,
    runtimeCron,
    jobWatcher,
    agentWatcher,
  };
};

export const waitForProcessShutdown = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const shutdown = (): void => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

export const launchScheduler = async (app: SchedulerApp): Promise<void> => {
  console.log("Scheduler running. Watching for job and runtime agent definition changes.");

  await waitForProcessShutdown();
  app.jobWatcher.close();
  app.agentWatcher.close();
};
