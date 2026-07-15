import type { CronJobDefinition } from "./cron-launcher.js";
import { z } from "zod";

import { fileExists, readTextFile, writeTextFile } from "../mcp/file-system.js";
import { isSchedulerTargetRoute } from "./cron-launcher.js";

export type CronJobRepository = {
  loadJobs(): Promise<CronJobDefinition[]>;
  saveJobs(jobs: CronJobDefinition[]): Promise<void>;
};

const cronJobSchema = z.object({
  jobName: z.string().min(1),
  schedule: z.string().min(1),
  targetRoute: z.string().refine((value) => isSchedulerTargetRoute(value), {
    message: "Invalid cron job target route",
  }),
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  // payload may be a string or a structured JSON object depending on the job
  payload: z.any().optional(),
});

const cronJobsSchema = z.array(cronJobSchema);

export const createCronJobRepository = (rootDir: string, relativePath: string): CronJobRepository => ({
  async loadJobs(): Promise<CronJobDefinition[]> {
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
  },
  async saveJobs(jobs: CronJobDefinition[]): Promise<void> {
    const result = cronJobsSchema.safeParse(jobs);

    if (!result.success) {
      throw new Error("Invalid cron job data provided for persistence");
    }

    await writeTextFile(rootDir, relativePath, `${JSON.stringify(result.data, null, 2)}\n`);
  },
});