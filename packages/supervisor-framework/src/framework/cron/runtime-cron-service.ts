import cron, { type ScheduledTask } from "node-cron";

import {
  findLastMatchingSlot,
  isClockJump,
  shouldCatchUp,
} from "./cron-clock-jump.js";
import { buildCronTriggerForJob } from "./cron-triggers.js";
import type { CronJobDefinition } from "./types.js";

/** Late wake (e.g. laptop sleep) still runs one eligible slot; node-cron caps by gap to next fire. */
const MISSED_EXECUTION_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SAMPLE_MS = 30 * 1000;
const CLOCK_JUMP_THRESHOLD_MS = 60 * 1000;

export type RuntimeCronService = {
  addJob(job: CronJobDefinition): Promise<void>;
  removeJob(jobName: string): Promise<void>;
  listActiveJobs(): CronJobDefinition[];
  stopAll(): Promise<void>;
};

export const createRuntimeCronService = (options: {
  runner: (job: { jobName: string; trigger: string; payload?: unknown }) => Promise<void>;
  timezone?: string;
}): RuntimeCronService => {
  const activeJobs = new Map<string, { job: CronJobDefinition; task: ScheduledTask }>();
  const catchingUp = new Set<string>();
  let lastSeenWallClockMs = Date.now();

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
      name: job.jobName,
      timezone: job.timezone ?? options.timezone ?? "UTC",
      missedExecutionTolerance: MISSED_EXECUTION_TOLERANCE_MS,
    });

    return task;
  };

  const catchUpAfterClockJump = async (): Promise<void> => {
    const now = new Date();

    for (const [jobName, { task }] of activeJobs) {
      if (catchingUp.has(jobName)) {
        continue;
      }

      const lastSlot = findLastMatchingSlot(task, now, MISSED_EXECUTION_TOLERANCE_MS);
      const nextRun = task.getNextRun();
      if (!lastSlot || !shouldCatchUp({
        lastSlot,
        nextRun,
        now,
        toleranceMs: MISSED_EXECUTION_TOLERANCE_MS,
      })) {
        continue;
      }

      catchingUp.add(jobName);
      try {
        console.log(
          `[RuntimeCron] Clock jump catch-up for job "${jobName}" (slot ${lastSlot.toISOString()})`,
        );
        await task.stop();
        try {
          await task.execute();
        } finally {
          await task.start();
        }
      } catch (error) {
        console.error(`[RuntimeCron] Clock jump catch-up failed for job "${jobName}":`, error);
      } finally {
        catchingUp.delete(jobName);
      }
    }
  };

  const sampler = setInterval(() => {
    const nowMs = Date.now();
    const jumped = isClockJump(lastSeenWallClockMs, nowMs, CLOCK_JUMP_THRESHOLD_MS);
    lastSeenWallClockMs = nowMs;
    if (!jumped) {
      return;
    }

    console.log("[RuntimeCron] Clock jump detected; catching up eligible jobs");
    void catchUpAfterClockJump();
  }, CLOCK_SAMPLE_MS);
  sampler.unref();

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

    async stopAll(): Promise<void> {
      clearInterval(sampler);
      for (const jobName of [...activeJobs.keys()]) {
        await this.removeJob(jobName);
      }
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

    async stopAll(): Promise<void> {
      if (!delegate) return;
      await delegate.stopAll();
    },
  };
};
