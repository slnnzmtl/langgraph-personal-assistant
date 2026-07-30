import type { CronJobDefinition, CronJobRepository } from "../../cron/types.js";

export const createNoopCronJobRepository = (): CronJobRepository => ({
  loadJobs: async () => [],
  saveJobs: async () => undefined,
  createJob: async (job: CronJobDefinition) => job,
  deleteJob: async (jobName: string) => ({
    jobName,
    schedule: "noop",
    targetRoute: "supervisor",
  }),
});
