import { Telegraf } from "telegraf";

import { createWorkflowContext } from "../app/workflow-context.js";
import type { AppConfig } from "../config.js";
import { createLazyCron, startCron, type LazyCronService } from "./cron-startup.js";
import { watchCronJobDefinitions, type CronJobWatcher } from "./cron-job-watcher.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import type { RuntimeCronService } from "./types.js";
import type { createWorkflowGraph } from "../agent.js";
import type { GeminiConnector } from "../connectors/llm-connector.js";

export type SchedulerApp = {
  config: AppConfig;
  graph: ReturnType<typeof createWorkflowGraph>;
  cronJobRepository: CronJobRepository;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  lazyCron: LazyCronService;
  runtimeCron: RuntimeCronService;
  jobWatcher: CronJobWatcher;
};

export const createSchedulerApp = async (config: AppConfig): Promise<SchedulerApp> => {
  const lazyCron = createLazyCron();
  const workflow = await createWorkflowContext(config, { runtimeCron: lazyCron });

  const bot = new Telegraf(config.telegramBotToken);

  await startCron({
    graph: workflow.graph,
    summaryModel: workflow.supervisorConnector.getModel(),
    config,
    lazyCron,
    cronJobRepository: workflow.cronJobRepository,
    telegram: bot.telegram,
    cronTargetAgentIds: workflow.cronTargetAgentIds,
    schedulerEnabled: config.schedulerEnabled,
  });

  const jobWatcher = watchCronJobDefinitions(config.cronJobsFilePath, {
    repository: workflow.cronJobRepository,
    runtimeCron: lazyCron,
  });

  return {
    config: workflow.config,
    graph: workflow.graph,
    cronJobRepository: workflow.cronJobRepository,
    cronTargetAgentIds: workflow.cronTargetAgentIds,
    supervisorConnector: workflow.supervisorConnector,
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
