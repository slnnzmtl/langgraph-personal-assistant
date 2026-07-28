import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  fileExists,
  readTextFile,
  resolveSafePath,
} from "../../core/persistence/file-system.js";
import { withSerializedFileWrite } from "../../core/persistence/json-store.js";
import { isCronTargetRoute } from "./cron-triggers.js";
import type { CronJobDefinition, CronJobRepository } from "./types.js";

export type CronTargetAgentIdsSource = readonly string[] | (() => readonly string[]);

const resolveCronTargetAgentIds = (source: CronTargetAgentIdsSource): readonly string[] =>
  typeof source === "function" ? source() : source;

const cronJobFieldsSchema = z.object({
  jobName: z.string().min(1),
  schedule: z.string().min(1),
  targetRoute: z.string(),
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  payload: z.any().optional(),
});

const parseCronJob = (
  job: unknown,
  cronTargetAgentIds: CronTargetAgentIdsSource,
): CronJobDefinition => {
  const parsed = cronJobFieldsSchema.safeParse(job);

  if (!parsed.success) {
    throw new Error("Invalid cron job data provided for persistence");
  }

  const targetAgentIds = resolveCronTargetAgentIds(cronTargetAgentIds);
  if (!isCronTargetRoute(parsed.data.targetRoute, targetAgentIds)) {
    throw new Error("Invalid cron job target route");
  }

  return parsed.data as CronJobDefinition;
};

const parseCronJobs = (
  jobs: unknown,
  cronTargetAgentIds: CronTargetAgentIdsSource,
): CronJobDefinition[] => {
  if (!Array.isArray(jobs)) {
    throw new Error("Invalid cron job data provided for persistence");
  }

  return jobs.map((job) => parseCronJob(job, cronTargetAgentIds));
};

const writeJobsAtomically = async (
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<void> => {
  const targetPath = resolveSafePath(rootDir, relativePath);
  const tempPath = `${targetPath}.tmp`;

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
};

export const createCronJobRepository = (
  rootDir: string,
  relativePath: string,
  cronTargetAgentIds: CronTargetAgentIdsSource = [],
): CronJobRepository => {
  const fileKey = resolveSafePath(rootDir, relativePath);

  const loadJobsFromDisk = async (): Promise<CronJobDefinition[]> => {
    if (!(await fileExists(rootDir, relativePath))) {
      return [];
    }

    const rawContent = await readTextFile(rootDir, relativePath);
    const parsed = JSON.parse(rawContent) as unknown;

    try {
      return parseCronJobs(parsed, cronTargetAgentIds);
    } catch {
      throw new Error(`Invalid cron job data in ${relativePath}`);
    }
  };

  const persistJobs = async (jobs: CronJobDefinition[]): Promise<void> => {
    const validated = parseCronJobs(jobs, cronTargetAgentIds);
    await writeJobsAtomically(rootDir, relativePath, `${JSON.stringify(validated, null, 2)}\n`);
  };

  return {
    async loadJobs(): Promise<CronJobDefinition[]> {
      return loadJobsFromDisk();
    },
    async saveJobs(jobs: CronJobDefinition[]): Promise<void> {
      await withSerializedFileWrite(fileKey, async () => {
        await persistJobs(jobs);
      });
    },
    async createJob(job: CronJobDefinition): Promise<CronJobDefinition> {
      return withSerializedFileWrite(fileKey, async () => {
        const created = parseCronJob(job, cronTargetAgentIds);

        const jobs = await loadJobsFromDisk();
        if (jobs.some((existing) => existing.jobName === created.jobName)) {
          throw new Error(`Cron job already exists: ${created.jobName}`);
        }

        await persistJobs([...jobs, created]);
        return created;
      });
    },
    async deleteJob(jobName: string): Promise<CronJobDefinition> {
      return withSerializedFileWrite(fileKey, async () => {
        const jobs = await loadJobsFromDisk();
        const found = jobs.find((job) => job.jobName === jobName);

        if (!found) {
          throw new Error(`Cron job not found: ${jobName}`);
        }

        await persistJobs(jobs.filter((job) => job.jobName !== jobName));
        return found;
      });
    },
  };
};

export const createCronJobRepositoryForConfig = (
  cronJobsFilePath: string,
  cronTargetAgentIds: CronTargetAgentIdsSource = [],
  cwd = process.cwd(),
): CronJobRepository =>
  createCronJobRepository(cwd, path.relative(cwd, cronJobsFilePath), cronTargetAgentIds);
