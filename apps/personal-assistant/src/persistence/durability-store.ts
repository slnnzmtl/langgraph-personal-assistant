import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";
import type {
  CronJobRun,
  CronRunLedger,
  CronRunRecord,
} from "@personal-assistant/supervisor-framework";

import type { AppConfig } from "../config.js";

const CRON_RUNS_SCHEMA = `
CREATE TABLE IF NOT EXISTS cron_runs (
  run_id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_runs_job_running
  ON cron_runs(job_name) WHERE status = 'running';
`;

type CronRunRow = {
  run_id: string;
  job_name: string;
  trigger: string;
  status: CronRunRecord["status"];
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};

const mapCronRunRow = (row: CronRunRow): CronRunRecord => ({
  runId: row.run_id,
  jobName: row.job_name,
  trigger: row.trigger,
  status: row.status,
  startedAt: row.started_at,
  ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  ...(row.error_message ? { errorMessage: row.error_message } : {}),
});

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error
  && "code" in error
  && (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE";

export const createSqliteCronRunLedger = (db: Database.Database): CronRunLedger => ({
  tryBeginRun(job: CronJobRun): CronRunRecord | null {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    try {
      db.prepare(
        `INSERT INTO cron_runs (run_id, job_name, trigger, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      ).run(runId, job.jobName, job.trigger, startedAt);

      return {
        runId,
        jobName: job.jobName,
        trigger: job.trigger,
        status: "running",
        startedAt,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return null;
      }

      throw error;
    }
  },

  completeRun(
    runId: string,
    result: { status: "succeeded" } | { status: "failed"; errorMessage: string },
  ): void {
    db.prepare(
      `UPDATE cron_runs
       SET status = ?, finished_at = ?, error_message = ?
       WHERE run_id = ?`,
    ).run(
      result.status,
      new Date().toISOString(),
      result.status === "failed" ? result.errorMessage : null,
      runId,
    );
  },

  getLatestRun(jobName: string): CronRunRecord | undefined {
    const row = db.prepare(
      `SELECT run_id, job_name, trigger, status, started_at, finished_at, error_message
       FROM cron_runs
       WHERE job_name = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    ).get(jobName) as CronRunRow | undefined;

    return row ? mapCronRunRow(row) : undefined;
  },

  listRecentRuns(jobName: string, limit = 10): CronRunRecord[] {
    const rows = db.prepare(
      `SELECT run_id, job_name, trigger, status, started_at, finished_at, error_message
       FROM cron_runs
       WHERE job_name = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    ).all(jobName, limit) as CronRunRow[];

    return rows.map(mapCronRunRow);
  },
});

export type DurabilityStore = {
  getCheckpointer(): BaseCheckpointSaver;
  getCronRunLedger(): CronRunLedger;
  close(): void;
};

export const openDurabilityStore = (config: AppConfig): DurabilityStore => {
  mkdirSync(path.dirname(config.stateDbPath), { recursive: true });

  const db = new Database(config.stateDbPath);
  db.exec(CRON_RUNS_SCHEMA);

  const checkpointer = SqliteSaver.fromConnString(config.stateDbPath);
  const cronRunLedger = createSqliteCronRunLedger(db);

  return {
    getCheckpointer: () => checkpointer,
    getCronRunLedger: () => cronRunLedger,
    close: () => {
      db.close();
    },
  };
};
