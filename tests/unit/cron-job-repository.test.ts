import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createCronJobRepository } from "../../src/cron/cron-job-repository.js";
import { defaultCronTargetAgentIds } from "../../src/app/runtime-agent-catalog.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pa-cron-jobs-"));
  tempPaths.push(tempRoot);
  return tempRoot;
};

describe("createCronJobRepository", () => {
  it("loads an empty list when the cron jobs file does not exist", async () => {
    const rootDir = await createTempRoot();
    const repository = createCronJobRepository(rootDir, "data/cron-jobs.json", defaultCronTargetAgentIds());

    await expect(repository.loadJobs()).resolves.toEqual([]);
  });

  it("saves and reloads cron jobs from the configured JSON file", async () => {
    const rootDir = await createTempRoot();
    const repository = createCronJobRepository(rootDir, "data/cron-jobs.json", defaultCronTargetAgentIds());
    const jobs = [
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
      {
        jobName: "obsidian-daily-note",
        schedule: "0 6 * * *",
        targetRoute: "obsidian",
        timezone: "America/New_York",
      },
    ] as const;

    await repository.saveJobs([...jobs]);

    await expect(repository.loadJobs()).resolves.toEqual(jobs);
  });

  it("rejects invalid persisted cron job data", async () => {
    const rootDir = await createTempRoot();
    const repository = createCronJobRepository(rootDir, "data/cron-jobs.json", defaultCronTargetAgentIds());
    await mkdir(path.join(rootDir, "data"), { recursive: true });
    await writeFile(path.join(rootDir, "data", "cron-jobs.json"), JSON.stringify([{ jobName: "bad-job" }]), "utf8");

    await expect(repository.loadJobs()).rejects.toThrow(/invalid cron job/i);
  });

  it("preserves all jobs when createJob calls overlap", async () => {
    const rootDir = await createTempRoot();
    const repository = createCronJobRepository(rootDir, "data/cron-jobs.json", defaultCronTargetAgentIds());

    await Promise.all([
      repository.createJob({
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      }),
      repository.createJob({
        jobName: "obsidian-daily-note",
        schedule: "0 6 * * *",
        targetRoute: "obsidian",
      }),
    ]);

    const jobs = await repository.loadJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.jobName).sort()).toEqual(["finance-sync", "obsidian-daily-note"]);
  });
});