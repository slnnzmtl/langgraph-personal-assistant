import { Telegraf } from "telegraf";

import {
  createSupervisorSystem,
  type PersonalSupervisorSystem,
} from "../composition/create-supervisor-system.js";
import {
  watchCronJobDefinitions,
  watchRuntimeAgentDefinitions,
  type CronJobWatcher,
  type RuntimeAgentWatcher,
  type RuntimeCronService,
} from "@personal-assistant/supervisor-framework";
import type { AppConfig } from "../config.js";
import { createLazyCron, startSchedulerRuntime, type LazyCronService } from "./scheduler-runtime.js";
import type { GeminiConnector } from "../models/gemini-connector.js";

export type SchedulerApp = {
  config: AppConfig;
  system: PersonalSupervisorSystem;
  runtimeCron: RuntimeCronService;
  jobWatcher: CronJobWatcher;
  agentWatcher: RuntimeAgentWatcher;
  supervisorConnector: GeminiConnector;
  shutdown(): Promise<void>;
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
    cronJobRepository: system.getCronJobRepository(),
    telegram: bot.telegram,
    cronTargetAgentIds: system.getCronTargetAgentIds(),
    schedulerEnabled: config.schedulerEnabled,
  });

  const jobWatcher = watchCronJobDefinitions(config.cronJobsFilePath, {
    repository: system.getCronJobRepository(),
    runtimeCron,
  });
  const agentWatcher = watchRuntimeAgentDefinitions(config.runtimeAgentsFilePath, system);

  return {
    config: system.config,
    system,
    supervisorConnector: system.supervisorConnector,
    runtimeCron,
    jobWatcher,
    agentWatcher,
    shutdown: async () => {
      jobWatcher.close();
      agentWatcher.close();
      await runtimeCron.stopAll();
      await system.shutdownAdapters();
    },
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
  await app.shutdown();
  process.exit(0);
};
