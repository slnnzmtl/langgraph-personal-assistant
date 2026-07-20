import type { CronJobDefinition, CronJobRepository, RuntimeCronService } from "./types.js";
import { cronJobsEqual } from "./cron-job-equality.js";

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
