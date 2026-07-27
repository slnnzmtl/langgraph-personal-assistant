import type { CronJobDefinition, CronJobRepository } from "../../src/framework/cron/types.js";

export const createCronRepositoryFake = (
  initialJobs: CronJobDefinition[] = [],
): CronJobRepository => {
  let storedJobs = [...initialJobs];

  const reload = (): CronJobDefinition[] => [...storedJobs];

  return {
    loadJobs: async () => reload(),
    saveJobs: async (jobs) => {
      storedJobs = [...jobs];
    },
    createJob: async (job) => {
      if (storedJobs.some((existing) => existing.jobName === job.jobName)) {
        throw new Error(`Cron job already exists: ${job.jobName}`);
      }
      storedJobs = [...storedJobs, job];
      return job;
    },
    deleteJob: async (jobName) => {
      const found = storedJobs.find((job) => job.jobName === jobName);
      if (!found) {
        throw new Error(`Cron job not found: ${jobName}`);
      }
      storedJobs = storedJobs.filter((job) => job.jobName !== jobName);
      return found;
    },
  };
};
