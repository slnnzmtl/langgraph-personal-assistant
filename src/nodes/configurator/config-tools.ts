import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { isCronTargetRoute } from "../../cron-triggers.js";
import type { CronJobDefinition, CronJobRepository } from "../../cron/types.js";
import { createReadSkillTool } from "../../tools/skill-management.js";

const CreateCronJobToolSchema = z.object({
  jobName: z.string().min(1),
  schedule: z.string().min(1),
  targetRoute: z.string().min(1),
  timezone: z.string().min(1).optional(),
  payload: z.string().min(1).optional(),
});

const DeleteCronJobToolSchema = z.object({
  jobName: z.string().min(1),
});

const ListCronJobsToolSchema = z.object({});

export const formatCronJobForDisplay = (job: CronJobDefinition): string => {
  const lines = [
    `Job name: ${job.jobName}`,
    `Schedule: ${job.schedule}`,
    `Target route: ${job.targetRoute}`,
  ];

  if (job.timezone) {
    lines.push(`Timezone: ${job.timezone}`);
  }

  if (job.payload !== undefined && job.payload !== null) {
    const payloadText = typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload, null, 2);
    lines.push(`Payload: ${payloadText}`);
  }

  return lines.join("\n");
};

export const createCronConfigTools = (repository: CronJobRepository): StructuredToolInterface[] => {
  const listCronJobs = tool(
    async () => {
      try {
        const jobs = await repository.loadJobs();
        return jobs.length > 0 ? jobs.map(formatCronJobForDisplay).join("\n\n") : "No cron jobs configured.";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "list_cron_jobs",
      description: "List all configured cron jobs.",
      schema: ListCronJobsToolSchema,
    },
  );

  const createCronJob = tool(
    async (input: z.infer<typeof CreateCronJobToolSchema>) => {
      try {
        if (!isCronTargetRoute(input.targetRoute)) {
          throw new Error(`Unknown target route: ${input.targetRoute}`);
        }

        const jobs = await repository.loadJobs();
        if (jobs.some((job) => job.jobName === input.jobName)) {
          throw new Error(`Cron job already exists: ${input.jobName}`);
        }

        const nextJob: CronJobDefinition = {
          jobName: input.jobName,
          schedule: input.schedule,
          targetRoute: input.targetRoute,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.payload ? { payload: input.payload } : {}),
        };

        await repository.saveJobs([...jobs, nextJob]);
        return `Created cron job ${input.jobName} targeting ${input.targetRoute}.\n\n${formatCronJobForDisplay(nextJob)}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_cron_job",
      description: "Create and persist a cron job definition for later scheduling.",
      schema: CreateCronJobToolSchema,
    },
  );

  const deleteCronJob = tool(
    async (input: z.infer<typeof DeleteCronJobToolSchema>) => {
      try {
        const jobs = await repository.loadJobs();
        const found = jobs.find((job) => job.jobName === input.jobName);

        if (!found) {
          throw new Error(`Cron job not found: ${input.jobName}`);
        }

        const remaining = jobs.filter((job) => job.jobName !== input.jobName);
        await repository.saveJobs(remaining);
        return `Deleted cron job ${input.jobName}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "delete_cron_job",
      description: "Delete a persisted cron job definition.",
      schema: DeleteCronJobToolSchema,
    },
  );

  return [listCronJobs, createCronJob, deleteCronJob, createReadSkillTool("configurator")];
};
