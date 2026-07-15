import cron, { type ScheduledTask } from "node-cron";

import type { CronJobDefinition } from "./cron-launcher.js";
import { buildSchedulerTriggerForJob } from "./protocol.js";

export type RuntimeSchedulerService = {
  addJob(job: CronJobDefinition): Promise<void>;
  removeJob(jobName: string): Promise<void>;
  listActiveJobs(): CronJobDefinition[];
};

/**
 * Create a runtime scheduler service that can add/remove jobs at runtime.
 * This is used to activate newly created cron jobs without restarting the app.
 * 
 * @param options Configuration for the runtime scheduler
 * @returns Service with addJob, removeJob, and listActiveJobs methods
 */
export const createRuntimeSchedulerService = (options: {
  // runner accepts payloads that may be string or structured JSON
  runner: (job: { jobName: string; trigger: string; payload?: unknown }) => Promise<void>;
  timezone?: string;
}): RuntimeSchedulerService => {
  const activeJobs = new Map<string, { job: CronJobDefinition; task: ScheduledTask }>();

    const scheduleJob = (job: CronJobDefinition): ScheduledTask => {
    const trigger = buildSchedulerTriggerForJob(job.targetRoute, job.jobName);
    const task = cron.schedule(job.schedule, async () => {
      try {
        await options.runner({
          jobName: job.jobName,
          trigger,
            ...(job.payload !== undefined ? { payload: job.payload } : {}),
        });
      } catch (error) {
        console.error(`[RuntimeScheduler] Failed to execute job "${job.jobName}":`, error);
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
        console.log(`[RuntimeScheduler] Added job: ${job.jobName} (${job.schedule})`);
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
      console.log(`[RuntimeScheduler] Removed job: ${jobName}`);
    },

    listActiveJobs(): CronJobDefinition[] {
      return Array.from(activeJobs.values()).map(({ job }) => job);
    },
  };
};

/**
 * Create a lazy-initialized scheduler service that starts empty.
 * The actual service can be set later via setService().
 * This is useful when the service needs to be passed to the graph,
 * but the graph is created before the scheduler is ready.
 */
export const createLazySchedulerService = (): RuntimeSchedulerService & { setService(service: RuntimeSchedulerService): void } => {
  let delegate: RuntimeSchedulerService | undefined;

  const ensureDelegate = () => {
    if (!delegate) {
      throw new Error("Scheduler service not initialized");
    }
  };

  return {
    setService(service: RuntimeSchedulerService): void {
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
