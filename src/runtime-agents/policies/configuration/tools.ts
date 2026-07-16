import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { isCronTargetRoute } from "../../../cron-triggers.js";
import type { CronJobDefinition, CronJobRepository } from "../../../cron/types.js";
import type { RuntimeAgentRepository } from "../../../core/agents/repository.js";
import {
  formatRuntimeToolBundleCatalog,
  validateRuntimeToolBundleIds,
} from "../../tool-bundles.js";
import type { RuntimeToolBundleDeps } from "../../bundle-deps.js";
import {
  RuntimeToolBundleIdSchema,
  SkillAttachmentRuleSchema,
  type RuntimeAgentDefinition,
  type RuntimeToolBundleId,
} from "../../../core/types/agent.js";
import { createReadSkillTool, createSkillCrudTools } from "../../../tools/skill-management.js";
import { createSkillScopedToolContextFromBundles } from "../../../tools/skill-scoped-registry.js";

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

const CreateRuntimeAgentToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  toolBundleIds: z.array(RuntimeToolBundleIdSchema).min(1),
  skillAttachments: z.array(SkillAttachmentRuleSchema).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

const UpdateRuntimeAgentToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  toolBundleIds: z.array(RuntimeToolBundleIdSchema).min(1).optional(),
  skillAttachments: z.array(SkillAttachmentRuleSchema).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

const RuntimeAgentIdToolSchema = z.object({
  id: z.string().min(1),
});

const ListRuntimeAgentsToolSchema = z.object({});

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

export const formatRuntimeAgentSummary = (agent: RuntimeAgentDefinition): string => {
  const attachmentSummary = (agent.skillAttachments ?? []).length > 0
    ? (agent.skillAttachments ?? []).map((rule) => `${rule.owner}/${rule.skillName}`).join(", ")
    : "none";

  const lines = [
    `Agent ID: ${agent.id}`,
    `Name: ${agent.name}`,
    `Description: ${agent.description}`,
    `Executor: ${agent.executor}`,
    `Tool Bundles: ${agent.toolBundleIds.join(", ")}`,
    `Skill Attachments: ${attachmentSummary}`,
    `Max Steps: ${agent.maxSteps}`,
    `Enabled: ${agent.enabled ? "true" : "false"}`,
    `Updated At: ${agent.updatedAt}`,
  ];

  return lines.join("\n");
};

export const formatRuntimeAgentPreview = (agent: RuntimeAgentDefinition): string => {
  const lines = [
    formatRuntimeAgentSummary(agent),
    `System Prompt:\n${agent.systemPrompt}`,
  ];

  return lines.join("\n\n");
};

export const createCronTools = (
  repository: CronJobRepository,
  cronTargetAgentIds: readonly string[] = [],
): StructuredToolInterface[] => {
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
        if (!isCronTargetRoute(input.targetRoute, cronTargetAgentIds)) {
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

  return [listCronJobs, createCronJob, deleteCronJob];
};

export const createRuntimeAgentTools = (
  repository: RuntimeAgentRepository,
  bundleDeps: RuntimeToolBundleDeps,
): StructuredToolInterface[] => {
  const listRuntimeAgents = tool(
    async () => {
      try {
        const agents = await repository.loadAgents();
        return agents.length > 0
          ? agents.map(formatRuntimeAgentSummary).join("\n\n")
          : "No runtime agents configured.";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "list_runtime_agents",
      description: "List all configured runtime agents without exposing full system prompts.",
      schema: ListRuntimeAgentsToolSchema,
    },
  );

  const previewRuntimeAgent = tool(
    async (input: z.infer<typeof RuntimeAgentIdToolSchema>) => {
      try {
        const agent = await repository.getAgent(input.id);
        if (!agent) {
          throw new Error(`Runtime agent not found: ${input.id}`);
        }

        return formatRuntimeAgentPreview(agent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "preview_runtime_agent",
      description: "Preview a runtime agent definition, including its full system prompt.",
      schema: RuntimeAgentIdToolSchema,
    },
  );

  const createRuntimeAgent = tool(
    async (input: z.infer<typeof CreateRuntimeAgentToolSchema>) => {
      try {
        validateRuntimeToolBundleIds(input.toolBundleIds as RuntimeToolBundleId[], bundleDeps);
        const agent = await repository.createAgent({
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          toolBundleIds: input.toolBundleIds as RuntimeToolBundleId[],
          executor: "generic",
          ...(input.skillAttachments !== undefined ? { skillAttachments: input.skillAttachments } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        return `Created runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_runtime_agent",
      description: "Create and persist a reusable runtime sub-agent from a name, routing description, system prompt, and allowlisted tool bundles.",
      schema: CreateRuntimeAgentToolSchema,
    },
  );

  const updateRuntimeAgent = tool(
    async (input: z.infer<typeof UpdateRuntimeAgentToolSchema>) => {
      try {
        if (input.toolBundleIds) {
          validateRuntimeToolBundleIds(input.toolBundleIds as RuntimeToolBundleId[], bundleDeps);
        }

        const agent = await repository.updateAgent(input.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
          ...(input.toolBundleIds !== undefined ? { toolBundleIds: input.toolBundleIds as RuntimeToolBundleId[] } : {}),
          ...(input.skillAttachments !== undefined ? { skillAttachments: input.skillAttachments } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        return `Updated runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "update_runtime_agent",
      description: "Update a persisted runtime agent definition, including enable/disable status.",
      schema: UpdateRuntimeAgentToolSchema,
    },
  );

  const deleteRuntimeAgent = tool(
    async (input: z.infer<typeof RuntimeAgentIdToolSchema>) => {
      try {
        const deleted = await repository.deleteAgent(input.id);
        return `Deleted runtime agent ${deleted.name} (${deleted.id}).`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "delete_runtime_agent",
      description: "Delete a persisted runtime agent definition. Requires explicit user confirmation before calling.",
      schema: RuntimeAgentIdToolSchema,
    },
  );

  const listRuntimeToolBundles = tool(
    async () => formatRuntimeToolBundleCatalog(bundleDeps),
    {
      name: "list_runtime_tool_bundles",
      description: "List the allowlisted runtime tool bundles available in this deployment.",
      schema: z.object({}),
    },
  );

  return [
    listRuntimeAgents,
    previewRuntimeAgent,
    createRuntimeAgent,
    updateRuntimeAgent,
    deleteRuntimeAgent,
    listRuntimeToolBundles,
  ];
};

export type ConfigurationToolDeps = RuntimeToolBundleDeps & {
  cronTargetAgentIds?: readonly string[];
};

export const createConfigurationSkillScopedTools = (
  repository: CronJobRepository,
  runtimeAgentRepository: RuntimeAgentRepository,
  bundleDeps: ConfigurationToolDeps,
) => {
  const cronTools = createCronTools(repository, bundleDeps.cronTargetAgentIds ?? []);
  const runtimeAgentTools = createRuntimeAgentTools(runtimeAgentRepository, bundleDeps);
  const skillManagementTools = createSkillCrudTools();
  const bundles = {
    cron: cronTools,
    "skill-management": skillManagementTools,
    "runtime-agents": runtimeAgentTools,
  };
  const readSkillTool = createReadSkillTool("configuration", "xml", { toolBundles: bundles });

  return createSkillScopedToolContextFromBundles({
    readSkillTool,
    bundles,
  });
};
