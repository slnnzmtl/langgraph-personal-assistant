import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteCronRunLedger, openDurabilityStore } from "../../../src/persistence/durability-store.js";
import type { AppConfig } from "../../../src/config.js";
import Database from "better-sqlite3";

const tmpRoot = path.join(process.cwd(), ".tmp", `durability-${process.pid}`);

const buildConfig = (stateDbPath: string): AppConfig =>
  ({
    telegramBotToken: "token",
    allowedTelegramUserId: "1",
    allowedTelegramChatId: "1",
    googleApiKey: "key",
    geminiModel: "gemini-1.5-flash",
    supervisorModel: "gemini-1.5-flash",
    obsidianModel: "gemini-1.5-flash",
    financeModel: "gemini-1.5-flash",
    configurationModel: "gemini-1.5-flash",
    obsidianVaultPath: "/tmp/vault",
    appTimezone: "UTC",
    schedulerEnabled: false,
    cronJobsFilePath: "/tmp/cron-jobs.json",
    runtimeAgentsFilePath: "/tmp/runtime-agents.json",
    stateDbPath,
    persistenceEnabled: true,
    messageHistoryMaxTokens: 8_000,
    healthPort: 8080,
    healthEnabled: true,
    logsDir: "/tmp/logs",
    logToFile: false,
    mcpMaxReconnectAttempts: 1,
    mcpReconnectBaseDelayMs: 0,
    mcpReconnectMaxDelayMs: 5_000,
  }) satisfies AppConfig;

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("durability store", () => {
  it("creates a sqlite database with checkpointer and cron ledger", () => {
    mkdirSync(tmpRoot, { recursive: true });
    const dbPath = path.join(tmpRoot, "state.db");
    const store = openDurabilityStore(buildConfig(dbPath));

    expect(store.getCheckpointer()).toBeDefined();
    expect(store.getCronRunLedger()).toBeDefined();

    store.close();
    expect(() => openDurabilityStore(buildConfig(dbPath))).not.toThrow();
  });

  it("rejects overlapping cron runs for the same job", () => {
    mkdirSync(tmpRoot, { recursive: true });
    const dbPath = path.join(tmpRoot, "ledger.db");
    const db = new Database(dbPath);
    db.exec(`
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
    `);

    const ledger = createSqliteCronRunLedger(db);
    const job = { jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance:finance-sync" };

    const first = ledger.tryBeginRun(job);
    const second = ledger.tryBeginRun(job);

    expect(first).toMatchObject({ jobName: "finance-sync", status: "running" });
    expect(second).toBeNull();

    ledger.completeRun(first!.runId, { status: "succeeded" });

    const third = ledger.tryBeginRun(job);
    expect(third).toMatchObject({ jobName: "finance-sync", status: "running" });

    db.close();
  });

  it("shares cron overlap state across separate ledger instances on the same db file", () => {
    mkdirSync(tmpRoot, { recursive: true });
    const dbPath = path.join(tmpRoot, "shared-ledger.db");

    const storeA = openDurabilityStore(buildConfig(dbPath));
    const storeB = openDurabilityStore(buildConfig(dbPath));

    const job = { jobName: "daily-sync", trigger: "SYSTEM_CRON_TRIGGER:finance:daily-sync" };
    const first = storeA.getCronRunLedger().tryBeginRun(job);
    const second = storeB.getCronRunLedger().tryBeginRun(job);

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    storeA.close();
    storeB.close();
  });
});
