import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { isCronTargetRoute } from "./cron-triggers.js";
import {
  fileExists,
  readTextFile,
  resolveSafePath,
  withSerializedFileWrite,
} from "@personal-assistant/supervisor-framework";
import type { CronJobDefinition } from "./cron-launcher.js";

export type CronJobRepository = {
  loadJobs(): Promise<CronJobDefinition[]>;
  saveJobs(jobs: CronJobDefinition[]): Promise<void>;
  createJob(job: CronJobDefinition): Promise<CronJobDefinition>;
  deleteJob(jobName: string): Promise<CronJobDefinition>;
};

const createCronJobSchema = (cronTargetAgentIds: readonly string[]) =>
  z.object({
    jobName: z.string().min(1),
    schedule: z.string().min(1),
    targetRoute: z.string().refine((value) => isCronTargetRoute(value, cronTargetAgentIds), {
      message: "Invalid cron job target route",
    }),
    enabled: z.boolean().optional(),
    timezone: z.string().min(1).optional(),
    payload: z.any().optional(),
  });

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
  cronTargetAgentIds: readonly string[] = [],
): CronJobRepository => {
  const cronJobSchema = createCronJobSchema(cronTargetAgentIds);
  const cronJobsSchema = z.array(cronJobSchema);
  const fileKey = resolveSafePath(rootDir, relativePath);

  const loadJobsFromDisk = async (): Promise<CronJobDefinition[]> => {
    if (!(await fileExists(rootDir, relativePath))) {
      return [];
    }

    const rawContent = await readTextFile(rootDir, relativePath);
    const parsed = JSON.parse(rawContent) as unknown;
    const result = cronJobsSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`Invalid cron job data in ${relativePath}`);
    }

    return result.data as CronJobDefinition[];
  };

  const persistJobs = async (jobs: CronJobDefinition[]): Promise<void> => {
    const result = cronJobsSchema.safeParse(jobs);

    if (!result.success) {
      throw new Error("Invalid cron job data provided for persistence");
    }

    await writeJobsAtomically(rootDir, relativePath, `${JSON.stringify(result.data, null, 2)}\n`);
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
        const parsed = cronJobSchema.safeParse(job);

        if (!parsed.success) {
          throw new Error("Invalid cron job data provided for persistence");
        }

        const jobs = await loadJobsFromDisk();
        if (jobs.some((existing) => existing.jobName === parsed.data.jobName)) {
          throw new Error(`Cron job already exists: ${parsed.data.jobName}`);
        }

        const created = parsed.data as CronJobDefinition;
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
  cronTargetAgentIds: readonly string[] = [],
  cwd = process.cwd(),
): CronJobRepository =>
  createCronJobRepository(cwd, path.relative(cwd, cronJobsFilePath), cronTargetAgentIds);
