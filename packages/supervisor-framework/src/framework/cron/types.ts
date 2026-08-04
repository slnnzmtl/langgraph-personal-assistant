import type { BaseMessage } from "@langchain/core/messages";

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

export type CronJobRun = {
  jobName: string;
  trigger: string;
  payload?: unknown;
};

export type CronJobResult = CronJobRun & {
  messages?: BaseMessage[];
  summary?: string;
};

export type CronExecutionReporter = {
  onStart?(job: CronJobRun): Promise<void> | void;
  onProgress?(job: CronJobRun, message: string): Promise<void> | void;
  onSuccess?(job: CronJobResult): Promise<void> | void;
  onError?(error: unknown, context: CronJobRun): Promise<void> | void;
};
