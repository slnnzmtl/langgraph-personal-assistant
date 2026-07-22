import type { CronJobRepository } from "../types.js";

export const createNoopCronJobRepository = (): CronJobRepository => ({
  loadJobs: async () => [],
  saveJobs: async () => undefined,
  createJob: async (job) => job,
  deleteJob: async () => undefined,
});
