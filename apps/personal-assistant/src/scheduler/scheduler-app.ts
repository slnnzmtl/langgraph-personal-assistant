import { Telegraf } from "telegraf";

import {
  getLogger,
  watchCronJobDefinitions,
  watchRuntimeAgentDefinitions,
  type CronJobWatcher,
  type ProcessLock,
  type RuntimeAgentWatcher,
  type RuntimeCronService,
} from "@personal-assistant/supervisor-framework";
import {
  createSupervisorSystem,
  type PersonalSupervisorSystem,
} from "../composition/create-supervisor-system.js";
import type { AppConfig } from "../config.js";
import { createLazyCron, startSchedulerRuntime, type LazyCronService } from "./scheduler-runtime.js";
import type { GeminiConnector } from "@personal-assistant/llm-gemini";

export type CreateSchedulerAppOptions = {
  processLock?: ProcessLock;
};

export type SchedulerApp = {
  config: AppConfig;
  system: PersonalSupervisorSystem;
  runtimeCron: RuntimeCronService;
  jobWatcher: CronJobWatcher;
  agentWatcher: RuntimeAgentWatcher;
  supervisorConnector: GeminiConnector;
  processLock?: ProcessLock;
  shutdown(): Promise<void>;
};

export const createSchedulerApp = async (
  config: AppConfig,
  options: CreateSchedulerAppOptions = {},
): Promise<SchedulerApp> => {
  const runtimeCron: LazyCronService = createLazyCron();
  const system = await createSupervisorSystem(config, { runtimeCron, dataWriteRole: "reader" });

  const bot = new Telegraf(config.telegramBotToken);

  await startSchedulerRuntime({
    getGraph: () => system.getGraph(),
    config,
    runtimeCron,
    cronJobRepository: system.getCronJobRepository(),
    telegram: bot.telegram,
    cronTargetAgentIds: system.getCronTargetAgentIds(),
    schedulerEnabled: config.schedulerEnabled,
    ...(system.getDurabilityStore()
      ? { cronRunLedger: system.getDurabilityStore()!.getCronRunLedger() }
      : {}),
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
    ...(options.processLock ? { processLock: options.processLock } : {}),
    shutdown: async () => {
      jobWatcher.close();
      agentWatcher.close();
      await runtimeCron.stopAll();
      await system.shutdownAdapters();
      await options.processLock?.release();
    },
  };
};

export const waitForProcessShutdown = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const shutdown = (): void => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

export type LaunchSchedulerOptions = {
  onShutdown?: () => Promise<void>;
};

export const launchScheduler = async (
  app: SchedulerApp,
  options: LaunchSchedulerOptions = {},
): Promise<void> => {
  getLogger().info(
    "Scheduler running in data read-only mode. Watching for job and runtime agent definition changes.",
  );

  await waitForProcessShutdown();
  await app.shutdown();
  await options.onShutdown?.();
  process.exit(0);
};
