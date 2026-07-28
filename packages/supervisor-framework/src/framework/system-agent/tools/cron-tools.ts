import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { CronJobRepository } from "../../cron/types.js";
import type { CronJobDefinition } from "../../cron/types.js";
import {
  buildDeleteCronJobConfirmToken,
  requireDestructiveConfirmToken,
} from "./destructive-confirm.js";

const CreateCronJobToolSchema = z.object({
  jobName: z.string().min(1),
  schedule: z.string().min(1),
  targetRoute: z.string().min(1),
  timezone: z.string().min(1).optional(),
  payload: z.string().min(1).optional(),
});

const DeleteCronJobToolSchema = z.object({
  jobName: z.string().min(1),
  confirmToken: z
    .string()
    .min(1)
    .describe('Must equal delete-cron-job:{jobName} after explicit user confirmation'),
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

const defaultValidateCronTargetRoute = (
  route: string,
  allowedRoutes: readonly string[],
): boolean => allowedRoutes.includes(route);

export type CronToolsOptions = {
  cronTargetAgentIds?: readonly string[];
  validateCronTargetRoute?: (route: string, allowedRoutes: readonly string[]) => boolean;
  writeAccess?: boolean;
};

export const createCronTools = (
  repository: CronJobRepository,
  options: CronToolsOptions = {},
): StructuredToolInterface[] => {
  const cronTargetAgentIds = options.cronTargetAgentIds ?? [];
  const validateRoute = options.validateCronTargetRoute ?? defaultValidateCronTargetRoute;

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

  if (!options.writeAccess) {
    return [listCronJobs];
  }

  const createCronJob = tool(
    async (input: z.infer<typeof CreateCronJobToolSchema>) => {
      try {
        if (!validateRoute(input.targetRoute, cronTargetAgentIds)) {
          throw new Error(`Unknown target route: ${input.targetRoute}`);
        }

        const nextJob: CronJobDefinition = {
          jobName: input.jobName,
          schedule: input.schedule,
          targetRoute: input.targetRoute,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.payload ? { payload: input.payload } : {}),
        };

        const created = await repository.createJob(nextJob);
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
        requireDestructiveConfirmToken(
          input.confirmToken,
          buildDeleteCronJobConfirmToken(input.jobName),
        );
        await repository.deleteJob(input.jobName);
        return `Deleted cron job ${input.jobName}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "delete_cron_job",
      description:
        "Delete a persisted cron job definition. Requires confirmToken matching delete-cron-job:{jobName}.",
      schema: DeleteCronJobToolSchema,
    },
  );

  return [listCronJobs, createCronJob, deleteCronJob];
};
