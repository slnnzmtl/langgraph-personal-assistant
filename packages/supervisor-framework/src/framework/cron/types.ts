import type { CronTargetRoute } from "./cron-triggers.js";

export type CronJobDefinition = {
  jobName: string;
  schedule: string;
  targetRoute: CronTargetRoute;
  enabled?: boolean;
  timezone?: string;
  payload?: unknown;
};

export type CronJobRepository = {
  loadJobs(): Promise<CronJobDefinition[]>;
  saveJobs(jobs: CronJobDefinition[]): Promise<void>;
  createJob(job: CronJobDefinition): Promise<CronJobDefinition>;
  deleteJob(jobName: string): Promise<CronJobDefinition>;
};
