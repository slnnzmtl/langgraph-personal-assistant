import type { CronJobDefinition, CronJobRepository } from "./types.js";
import type { RuntimeCronService } from "./runtime-cron-service.js";

const cronJobsEqual = (left: CronJobDefinition, right: CronJobDefinition): boolean =>
  left.jobName === right.jobName
  && left.schedule === right.schedule
  && left.targetRoute === right.targetRoute
  && left.enabled === right.enabled
  && left.timezone === right.timezone
  && JSON.stringify(left.payload) === JSON.stringify(right.payload);

export const reconcileRuntimeCron = async (
  repository: CronJobRepository,
  runtimeCron?: RuntimeCronService,
): Promise<void> => {
  if (!runtimeCron) {
    return;
  }

  const persistedJobs = await repository.loadJobs();
  const persistedJobsByName = new Map(persistedJobs.map((job) => [job.jobName, job]));
  const activeJobs = runtimeCron.listActiveJobs();
  const activeJobsByName = new Map(activeJobs.map((job) => [job.jobName, job]));

  for (const [jobName, activeJob] of activeJobsByName) {
    const desiredJob = persistedJobsByName.get(jobName);

    if (!desiredJob || desiredJob.enabled === false) {
      await runtimeCron.removeJob(jobName);
      continue;
    }

    if (!cronJobsEqual(activeJob, desiredJob)) {
      await runtimeCron.removeJob(jobName);
      await runtimeCron.addJob(desiredJob);
    }
  }

  for (const job of persistedJobs) {
    if (job.enabled === false) {
      continue;
    }

    const isActive = runtimeCron.listActiveJobs().some((activeJob) => activeJob.jobName === job.jobName);
    if (!isActive) {
      await runtimeCron.addJob(job);
    }
  }
};
