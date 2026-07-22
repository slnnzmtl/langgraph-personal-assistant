import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { isCronTargetRoute } from "../../../cron-triggers.js";
import type { CronJobDefinition, CronJobRepository } from "../../../cron/types.js";
import {
  resolveAgentCapabilityIds,
  type CapabilityCatalog,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  createDefaultCapabilityCatalog,
  formatGrantableCapabilityCatalog,
  type CapabilityDeps,
  validateCapabilityIds,
  validateGrantableCapabilityIds,
} from "../../builtin-capabilities.js";
import { createReadSkillTool, createSkillCrudTools } from "../../../tools/skill-management.js";

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
  capabilityIds: z.array(z.string().min(1)).min(1),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

const UpdateRuntimeAgentToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  capabilityIds: z.array(z.string().min(1)).min(1).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

const RuntimeAgentIdToolSchema = z.object({
  id: z.string().min(1),
});

const ListRuntimeAgentsToolSchema = z.object({});

export type SystemConfigToolsOptions = {
  writeAccess?: boolean;
  skillCatalog?: SkillCatalog;
  capabilityCatalog?: CapabilityCatalog;
};

export const RUNTIME_AGENT_RESTART_REQUIRED_NOTE =
  "Restart the bot and scheduler processes before this agent can receive routed requests.";

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
  const lines = [
    `Agent ID: ${agent.id}`,
    `Name: ${agent.name}`,
    `Description: ${agent.description}`,
    `Executor: ${agent.executor}`,
    `Capabilities: ${resolveAgentCapabilityIds(agent).join(", ")}`,
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
  options: { writeAccess?: boolean } = {},
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

  if (!options.writeAccess) {
    return [listCronJobs];
  }

  const createCronJob = tool(
    async (input: z.infer<typeof CreateCronJobToolSchema>) => {
      try {
        if (!isCronTargetRoute(input.targetRoute, cronTargetAgentIds)) {
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

export const createRuntimeAgentTools = (
  repository: RuntimeAgentRepository,
  capabilityDeps: CapabilityDeps,
  options: { writeAccess?: boolean; capabilityCatalog?: CapabilityCatalog } = {},
): StructuredToolInterface[] => {
  const capabilityCatalog = options.capabilityCatalog ?? createDefaultCapabilityCatalog();
  const capabilityIdSchema = capabilityCatalog.createIdSchema();

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

  const listCapabilities = tool(
    async () => formatGrantableCapabilityCatalog(capabilityDeps),
    {
      name: "list_capabilities",
      description: "List grantable capabilities available in this deployment.",
      schema: z.object({}),
    },
  );

  const readTools = [
    listRuntimeAgents,
    previewRuntimeAgent,
    listCapabilities,
  ];

  if (!options.writeAccess) {
    return readTools;
  }

  const createRuntimeAgent = tool(
    async (input: z.infer<typeof CreateRuntimeAgentToolSchema>) => {
      try {
        validateGrantableCapabilityIds(input.capabilityIds, capabilityDeps);
        validateCapabilityIds(input.capabilityIds, capabilityDeps);
        const agent = await repository.createAgent({
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          capabilityIds: input.capabilityIds,
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        return `Created runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}\n\n${RUNTIME_AGENT_RESTART_REQUIRED_NOTE}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_runtime_agent",
      description: "Create and persist a reusable runtime sub-agent from a name, routing description, system prompt, and allowlisted capabilities.",
      schema: CreateRuntimeAgentToolSchema.extend({
        capabilityIds: z.array(capabilityIdSchema).min(1),
      }),
    },
  );

  const updateRuntimeAgent = tool(
    async (input: z.infer<typeof UpdateRuntimeAgentToolSchema>) => {
      try {
        if (input.capabilityIds) {
          validateGrantableCapabilityIds(input.capabilityIds, capabilityDeps);
          validateCapabilityIds(input.capabilityIds, capabilityDeps);
        }

        const agent = await repository.updateAgent(input.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
          ...(input.capabilityIds !== undefined ? { capabilityIds: input.capabilityIds } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        const restartNote = agent.enabled ? `\n\n${RUNTIME_AGENT_RESTART_REQUIRED_NOTE}` : "";

        return `Updated runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}${restartNote}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "update_runtime_agent",
      description: "Update a persisted runtime agent definition, including enable/disable status.",
      schema: UpdateRuntimeAgentToolSchema.extend({
        capabilityIds: z.array(capabilityIdSchema).min(1).optional(),
      }),
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

  return [
    ...readTools,
    createRuntimeAgent,
    updateRuntimeAgent,
    deleteRuntimeAgent,
  ];
};

export const createSystemConfigDomainTools = (
  capabilityDeps: CapabilityDeps,
  options: SystemConfigToolsOptions = {},
): StructuredToolInterface[] => {
  if (!capabilityDeps.cronJobRepository || !capabilityDeps.runtimeAgentRepository) {
    throw new Error("system-config capability requires cron and runtime agent repositories.");
  }

  const writeAccess = options.writeAccess ?? true;
  const cronTools = createCronTools(
    capabilityDeps.cronJobRepository,
    capabilityDeps.cronTargetAgentIds ?? [],
    { writeAccess },
  );
  const runtimeAgentTools = createRuntimeAgentTools(
    capabilityDeps.runtimeAgentRepository,
    capabilityDeps,
    {
      writeAccess,
      ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
    },
  );
  const skillManagementTools = createSkillCrudTools({
    writeAccess,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
  });

  return [
    ...cronTools,
    ...skillManagementTools,
    ...runtimeAgentTools,
  ];
};
