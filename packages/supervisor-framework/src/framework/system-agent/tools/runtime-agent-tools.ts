import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  resolveAgentCapabilityIds,
  type RuntimeAgentDefinition,
} from "../../../core/types/agent.js";
import type { RuntimeAgentRepository } from "../../../core/agents/repository.js";
import {
  withResolvedAgentSystemPrompt,
  type LoadPromptByKey,
} from "../../../core/agents/resolve-system-prompt.js";
import type { CapabilityCatalog } from "../../../capabilities/index.js";
import {
  configurationReposAvailable,
  type CapabilityAvailabilityContext,
} from "../../../capabilities/types.js";
import type { SystemConfigDeps } from "../definition.js";

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

export const RUNTIME_AGENT_RELOAD_NOTE =
  "The bot and scheduler will pick up routing changes automatically within a few seconds.";

export const formatRuntimeAgentSummary = (agent: RuntimeAgentDefinition): string => {
  const lines = [
    `Agent ID: ${agent.id}`,
    `Name: ${agent.name}`,
    `Description: ${agent.description}`,
    ...(agent.modelKey ? [`Model: ${agent.modelKey}`] : []),
    `Capabilities: ${resolveAgentCapabilityIds(agent).join(", ")}`,
    `Max Steps: ${agent.maxSteps}`,
    `Enabled: ${agent.enabled ? "true" : "false"}`,
    `Updated At: ${agent.updatedAt}`,
  ];

  return lines.join("\n");
};

export const formatRuntimeAgentPreview = (
  agent: RuntimeAgentDefinition,
  loadPromptByKey?: LoadPromptByKey,
): string => {
  const resolved = loadPromptByKey ? withResolvedAgentSystemPrompt(agent, loadPromptByKey) : agent;
  return [formatRuntimeAgentSummary(resolved), `System Prompt:\n${resolved.systemPrompt}`].join("\n\n");
};

const formatPromptFileNote = (
  repository: RuntimeAgentRepository,
  agent: RuntimeAgentDefinition,
): string => {
  const location = repository.describePromptLocation?.(agent.id);
  return location ? `\nPrompt file: ${location}` : "";
};

const toAvailabilityContext = (deps: SystemConfigDeps): CapabilityAvailabilityContext => ({
  configurationReposAvailable: configurationReposAvailable(deps),
});

export const createRuntimeAgentTools = (
  repository: RuntimeAgentRepository,
  deps: SystemConfigDeps,
  options: { writeAccess?: boolean; capabilityCatalog?: CapabilityCatalog; loadPromptByKey?: LoadPromptByKey } = {},
): StructuredToolInterface[] => {
  if (!options.capabilityCatalog) {
    throw new Error("Runtime agent tools require a capability catalog.");
  }

  const capabilityCatalog = options.capabilityCatalog;
  const availabilityContext = toAvailabilityContext(deps);
  const capabilityIdSchema = capabilityCatalog.createIdSchema();
  const loadPromptByKey = options.loadPromptByKey ?? deps.loadPromptByKey;

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

        return formatRuntimeAgentPreview(agent, loadPromptByKey);
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
    async () => capabilityCatalog.formatGrantableCatalog(availabilityContext),
    {
      name: "list_capabilities",
      description: "List grantable capabilities available in this deployment.",
      schema: z.object({}),
    },
  );

  const readTools = [listRuntimeAgents, listCapabilities];

  if (!options.writeAccess) {
    return readTools;
  }

  const createRuntimeAgent = tool(
    async (input: z.infer<typeof CreateRuntimeAgentToolSchema>) => {
      try {
        capabilityCatalog.validateGrantableIds(input.capabilityIds, availabilityContext);
        capabilityCatalog.validateIds(input.capabilityIds, availabilityContext);
        const agent = await repository.createAgent({
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          capabilityIds: input.capabilityIds,
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        return `Created runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}${formatPromptFileNote(repository, agent)}\n\n${RUNTIME_AGENT_RELOAD_NOTE}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_runtime_agent",
      description:
        "Create and persist a reusable runtime sub-agent from a name, routing description, system prompt, and allowlisted capabilities.",
      schema: CreateRuntimeAgentToolSchema.extend({
        capabilityIds: z.array(capabilityIdSchema).min(1),
      }),
    },
  );

  const updateRuntimeAgent = tool(
    async (input: z.infer<typeof UpdateRuntimeAgentToolSchema>) => {
      try {
        if (input.capabilityIds) {
          capabilityCatalog.validateGrantableIds(input.capabilityIds, availabilityContext);
          capabilityCatalog.validateIds(input.capabilityIds, availabilityContext);
        }

        const agent = await repository.updateAgent(input.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
          ...(input.capabilityIds !== undefined ? { capabilityIds: input.capabilityIds } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        });

        const reloadNote = agent.enabled ? `\n\n${RUNTIME_AGENT_RELOAD_NOTE}` : "";

        return `Updated runtime agent ${agent.name}.\n\n${formatRuntimeAgentSummary(agent)}${formatPromptFileNote(repository, agent)}${reloadNote}`;
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
      description:
        "Delete a persisted runtime agent definition. Requires explicit user confirmation before calling.",
      schema: RuntimeAgentIdToolSchema,
    },
  );

  return [...readTools, previewRuntimeAgent, createRuntimeAgent, updateRuntimeAgent, deleteRuntimeAgent];
};
