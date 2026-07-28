import type { CronJobRun } from "./cron-runner.js";

export type CronRunStatus = "running" | "succeeded" | "failed";

export type CronRunRecord = {
  runId: string;
  jobName: string;
  trigger: string;
  status: CronRunStatus;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
};

export type CronRunLedger = {
  /** Atomically claim a run; returns null if another run for jobName is already running. */
  tryBeginRun(job: CronJobRun): CronRunRecord | null;
  completeRun(
    runId: string,
    result: { status: "succeeded" } | { status: "failed"; errorMessage: string },
  ): void;
  getLatestRun(jobName: string): CronRunRecord | undefined;
  listRecentRuns?(jobName: string, limit?: number): CronRunRecord[];
};
