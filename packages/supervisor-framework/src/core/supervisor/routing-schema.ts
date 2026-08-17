import { z } from "zod";

import type { RuntimeAgentDefinition } from "../types/agent.js";

const PLACEHOLDER_REPLY_VALUES = new Set(["null", "undefined", "none", "n/a"]);

export type ExecutionStep = {
  agentId: string;
  task?: string;
};

export const normalizeSupervisorReply = (reply: string | undefined): string | undefined => {
  if (typeof reply !== "string") {
    return undefined;
  }

  const trimmed = reply.trim();
  if (trimmed.length === 0 || PLACEHOLDER_REPLY_VALUES.has(trimmed.toLowerCase())) {
    return undefined;
  }

  return trimmed;
};

export const normalizeOptionalTask = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const toExecutionStep = (step: {
  agentId: string;
  task?: string | undefined;
}): ExecutionStep => {
  const task = normalizeOptionalTask(step.task);
  return task ? { agentId: step.agentId, task } : { agentId: step.agentId };
};

const BUILTIN_SUPERVISOR_ROUTES = ["FINISH"] as const;

const formatRoutableAgentList = (routableAgents: RuntimeAgentDefinition[]): string[] =>
  routableAgents.map((agent) => `- ${agent.id}: ${agent.description}`);

const buildRoutingDescription = (routableAgents: RuntimeAgentDefinition[]): string => {
  const base = [
    "The next graph node to execute.",
    "Use FINISH for general chat or any request you can answer directly.",
  ];

  if (routableAgents.length > 0) {
    base.push("Route to a runtime agent id when the request clearly matches one of these specialists:");
    base.push(...formatRoutableAgentList(routableAgents));
  }

  return base.join(" ");
};

const optionalTaskSchema = z
  .string()
  .describe(
    "Focused brief for this specialist: remaining work, constraints, and what to ignore. Omit when the current user message is already sufficient.",
  )
  .optional();

const buildQueueDescription = (routableAgents: RuntimeAgentDefinition[]): string => {
  const base = [
    "Ordered list of specialists to execute sequentially before the supervisor re-plans.",
    "Each step includes agentId and an optional task brief. Specialists receive scoped conversation history, the current user message, and the task when provided.",
    "Use a one-item queue when a single specialist needs a task brief. Omit queue when next alone is enough (no brief) or when FINISH.",
    "When present, queue must include every specialist in order, including the first.",
  ];

  if (routableAgents.length > 0) {
    base.push("Each agentId must be one of:");
    base.push(...formatRoutableAgentList(routableAgents));
  }

  return base.join(" ");
};

export const filterRoutableRuntimeAgents = (
  runtimeAgents: RuntimeAgentDefinition[],
  wiredAgentIds: ReadonlySet<string>,
): RuntimeAgentDefinition[] =>
  runtimeAgents.filter((agent) => agent.enabled && wiredAgentIds.has(agent.id));

export const buildSupervisorRoutingSchema = (
  runtimeAgents: RuntimeAgentDefinition[] = [],
  wiredAgentIds?: ReadonlySet<string>,
) => {
  const routableAgents = wiredAgentIds
    ? filterRoutableRuntimeAgents(runtimeAgents, wiredAgentIds)
    : runtimeAgents.filter((agent) => agent.enabled);

  const routeNames = [...BUILTIN_SUPERVISOR_ROUTES, ...routableAgents.map((agent) => agent.id)] as [
    string,
    ...string[],
  ];

  const agentRouteNames = routableAgents.map((agent) => agent.id) as [string, ...string[]];

  const executionStepSchema = agentRouteNames.length > 0
    ? z.object({
      agentId: z.enum(agentRouteNames).describe("Runtime agent id to execute."),
      task: optionalTaskSchema,
    })
    : z.object({
      agentId: z.string(),
      task: optionalTaskSchema,
    });

  return z.object({
    next: z.enum(routeNames).describe(buildRoutingDescription(routableAgents)),
    queue: agentRouteNames.length > 0
      ? z
        .array(executionStepSchema)
        .optional()
        .describe(buildQueueDescription(routableAgents))
      : z.array(z.never()).optional(),
    reply: z
      .string()
      .optional()
      .transform(normalizeSupervisorReply)
      .describe(
        "The conversational response sent back to the user. Required when 'next' is 'FINISH'. Omit this field entirely when routing to a runtime agent.",
      ),
  });
};

export type RoutingDecision = z.infer<ReturnType<typeof buildSupervisorRoutingSchema>>;
