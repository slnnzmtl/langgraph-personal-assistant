import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { CronJobRepository } from "../../types.js";
import type { SystemConfigToolsOptions, SystemCronJob } from "../types.js";

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

export const formatCronJobForDisplay = (job: SystemCronJob): string => {
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

const defaultValidateCronTargetRoute = (
  route: string,
  allowedRoutes: readonly string[],
): boolean => allowedRoutes.includes(route);

export const createCronTools = (
  repository: CronJobRepository,
  options: Pick<SystemConfigToolsOptions, "cronTargetAgentIds" | "validateCronTargetRoute" | "writeAccess"> = {},
): StructuredToolInterface[] => {
  const cronTargetAgentIds = options.cronTargetAgentIds ?? [];
  const validateRoute = options.validateCronTargetRoute ?? defaultValidateCronTargetRoute;

  const listCronJobs = tool(
    async () => {
      try {
        const jobs = (await repository.loadJobs()) as SystemCronJob[];
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

  if (!options.writeAccess) {
    return [listCronJobs];
  }

  const createCronJob = tool(
    async (input: z.infer<typeof CreateCronJobToolSchema>) => {
      try {
        if (!validateRoute(input.targetRoute, cronTargetAgentIds)) {
          throw new Error(`Unknown target route: ${input.targetRoute}`);
        }

        const nextJob: SystemCronJob = {
          jobName: input.jobName,
          schedule: input.schedule,
          targetRoute: input.targetRoute,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.payload ? { payload: input.payload } : {}),
        };

        const created = (await repository.createJob(nextJob)) as SystemCronJob;
        return `Created cron job ${input.jobName} targeting ${input.targetRoute}.\n\n${formatCronJobForDisplay(created)}`;
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
        await repository.deleteJob(input.jobName);
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

  return [listCronJobs, createCronJob, deleteCronJob];
};
