import {
  buildCronTriggerForJob,
  isCronTargetRoute,
  type CronTargetRoute,
} from "../cron-triggers.js";
import type { CronRunner } from "./cron-runner.js";

type ScheduleFn = (expression: string, task: () => void | Promise<void>, options?: { timezone?: string }) => unknown;

export type CronJobDefinition = {
  jobName: string;
  schedule: string;
  targetRoute: CronTargetRoute;
  enabled?: boolean;
  timezone?: string;
  payload?: unknown;
};

export type SetupCronOptions = {
  enabled: boolean;
  defaultTimezone: string;
  schedule: ScheduleFn;
  runner: CronRunner;
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

    if (!isCronTargetRoute(job.targetRoute)) {
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
          trigger: buildCronTriggerForJob(job.targetRoute, job.jobName),
          ...(job.payload !== undefined ? { payload: job.payload } : {}),
        });
      },
      { timezone: job.timezone ?? options.defaultTimezone },
    );
  }
};
