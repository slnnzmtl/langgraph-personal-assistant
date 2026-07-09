import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import type { RouteName } from "../state.js";
import type { SchedulerRunner } from "./scheduler-runner.js";

const SCHEDULER_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export type SchedulerTargetRoute = Exclude<RouteName, "FINISH">;

const SCHEDULER_TRIGGER_ROUTES: Record<string, SchedulerTargetRoute> = {
  "finance-sync": "Finance_SG",
  "obsidian-daily-note": "Obsidian_SG",
};

const SCHEDULER_TARGET_ROUTES = new Set<RouteName>(["Finance_SG", "Obsidian_SG", "Config_SG", "Supervise_SG", "FINISH"].filter((routeName) => routeName !== "FINISH") as RouteName[]);

const extractTextContent = (message: BaseMessage): string | null => {
  if (!(message instanceof HumanMessage)) {
    return null;
  }

  return typeof message.content === "string" ? message.content.trim() : null;
};

export const isSchedulerTargetRoute = (value: string): value is SchedulerTargetRoute =>
  SCHEDULER_TARGET_ROUTES.has(value as RouteName);

export const resolveSchedulerTriggerRoute = (message: BaseMessage | undefined): RouteName | null => {
  if (!message) {
    return null;
  }

  const text = extractTextContent(message);
  if (!text?.startsWith(SCHEDULER_TRIGGER_PREFIX)) {
    return null;
  }

  const triggerName = text.slice(SCHEDULER_TRIGGER_PREFIX.length).trim();
  const legacyRoute = SCHEDULER_TRIGGER_ROUTES[triggerName];
  if (legacyRoute) {
    return legacyRoute;
  }

  const derivedRoute = triggerName.split(ROUTE_TRIGGER_SEPARATOR, 1)[0];
  if (derivedRoute && isSchedulerTargetRoute(derivedRoute)) {
    return derivedRoute as SchedulerTargetRoute;
  }

  return null;
};

export const buildSchedulerTrigger = (triggerName: keyof typeof SCHEDULER_TRIGGER_ROUTES): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${triggerName}`;

export const buildSchedulerTriggerForJob = (targetRoute: SchedulerTargetRoute, jobName: string): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${targetRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;

type ScheduleFn = (expression: string, task: () => void | Promise<void>, options?: { timezone?: string }) => unknown;

export type CronJobDefinition = {
  jobName: string;
  schedule: string;
  targetRoute: SchedulerTargetRoute;
  enabled?: boolean;
  timezone?: string;
  payload?: string;
};

export type SetupCronOptions = {
  enabled: boolean;
  defaultTimezone: string;
  schedule: ScheduleFn;
  runner: SchedulerRunner;
  jobs: CronJobDefinition[];
};

export const validateCronJobs = (jobs: CronJobDefinition[]): void => {
  const seenJobNames = new Set<string>();

  for (const job of jobs) {
    if (!job.jobName.trim()) {
      throw new Error("Cron job name is required.");
    }

    if (!job.schedule.trim()) {
      throw new Error(`Cron schedule is required for job: ${job.jobName}`);
    }

    if (!isSchedulerTargetRoute(job.targetRoute)) {
      throw new Error(`Unknown target route: ${job.targetRoute}`);
    }

    if (seenJobNames.has(job.jobName)) {
      throw new Error(`Duplicate job name: ${job.jobName}`);
    }

    seenJobNames.add(job.jobName);
  }
};

export const setupCron = (options: SetupCronOptions): void => {
  if (!options.enabled) {
    return;
  }

  validateCronJobs(options.jobs);

  for (const job of options.jobs) {
    if (job.enabled === false) {
      continue;
    }

    options.schedule(
      job.schedule,
      async () => {
        await options.runner.run({
          jobName: job.jobName,
          trigger: buildSchedulerTriggerForJob(job.targetRoute, job.jobName),
        });
      },
      { timezone: job.timezone ?? options.defaultTimezone },
    );
  }
};