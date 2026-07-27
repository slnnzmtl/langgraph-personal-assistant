import cron, { type ScheduledTask } from "node-cron";

import { buildCronTriggerForJob } from "./cron-triggers.js";
import type { CronJobDefinition } from "./types.js";

export type RuntimeCronService = {
  addJob(job: CronJobDefinition): Promise<void>;
  removeJob(jobName: string): Promise<void>;
  listActiveJobs(): CronJobDefinition[];
};

export const createRuntimeCronService = (options: {
  runner: (job: { jobName: string; trigger: string; payload?: unknown }) => Promise<void>;
  timezone?: string;
}): RuntimeCronService => {
  const activeJobs = new Map<string, { job: CronJobDefinition; task: ScheduledTask }>();

  const scheduleJob = (job: CronJobDefinition): ScheduledTask => {
    const trigger = buildCronTriggerForJob(job.targetRoute, job.jobName);
    const task = cron.schedule(job.schedule, async () => {
      try {
        await options.runner({
          jobName: job.jobName,
          trigger,
          ...(job.payload !== undefined ? { payload: job.payload } : {}),
        });
      } catch (error) {
        console.error(`[RuntimeCron] Failed to execute job "${job.jobName}":`, error);
      }
    }, {
      timezone: job.timezone ?? options.timezone ?? "UTC",
    });

    return task;
  };

  return {
    async addJob(job: CronJobDefinition): Promise<void> {
      if (activeJobs.has(job.jobName)) {
        throw new Error(`Job already scheduled: ${job.jobName}`);
      }

      try {
        const task = scheduleJob(job);
        activeJobs.set(job.jobName, { job, task });
        console.log(`[RuntimeCron] Added job: ${job.jobName} (${job.schedule})`);
      } catch (error) {
        throw new Error(`Failed to schedule job "${job.jobName}": ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async removeJob(jobName: string): Promise<void> {
      const entry = activeJobs.get(jobName);
      if (!entry) {
        throw new Error(`Job not found: ${jobName}`);
      }

      entry.task.stop();
      entry.task.destroy();
      activeJobs.delete(jobName);
      console.log(`[RuntimeCron] Removed job: ${jobName}`);
    },

    listActiveJobs(): CronJobDefinition[] {
      return Array.from(activeJobs.values()).map(({ job }) => job);
    },
  };
};

export const createLazyCronService = (): RuntimeCronService & { setService(service: RuntimeCronService): void } => {
  let delegate: RuntimeCronService | undefined;

  const ensureDelegate = () => {
    if (!delegate) {
      throw new Error("Cron service not initialized");
    }
  };

  return {
    setService(service: RuntimeCronService): void {
      delegate = service;
    },

    async addJob(job: CronJobDefinition): Promise<void> {
      ensureDelegate();
      return delegate!.addJob(job);
    },

    async removeJob(jobName: string): Promise<void> {
      ensureDelegate();
      return delegate!.removeJob(jobName);
    },

    listActiveJobs(): CronJobDefinition[] {
      if (!delegate) return [];
      return delegate.listActiveJobs();
    },
  };
};
