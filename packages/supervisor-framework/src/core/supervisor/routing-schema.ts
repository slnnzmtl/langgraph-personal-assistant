import { z } from "zod";

import type { RuntimeAgentDefinition } from "../types/agent.js";

const PLACEHOLDER_REPLY_VALUES = new Set(["null", "undefined", "none", "n/a"]);

export type ExecutionStep = {
  agentId: string;
  prompt: string;
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

export const normalizeDelegationPrompt = (prompt: string | undefined): string | undefined => {
  if (typeof prompt !== "string") {
    return undefined;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const BUILTIN_SUPERVISOR_ROUTES = ["FINISH"] as const;

const buildRoutingDescription = (routableAgents: RuntimeAgentDefinition[]): string => {
  const base = [
    "The next graph node to execute.",
    "Use FINISH for general chat or any request you can answer directly.",
  ];

  if (routableAgents.length > 0) {
    base.push("Route to a runtime agent id when the request clearly matches one of these specialists:");
    for (const agent of routableAgents) {
      base.push(`- ${agent.id}: ${agent.description}`);
    }
  }

  return base.join(" ");
};

const buildQueueDescription = (routableAgents: RuntimeAgentDefinition[]): string => {
  const base = [
    "Optional ordered list of runtime agent steps to execute sequentially before the supervisor re-plans.",
    "Each step includes agentId and a self-contained prompt for that specialist.",
    "Use when a request clearly needs multiple specialists in order.",
    "Omit for single-agent routing via next and prompt alone.",
  ];

  if (routableAgents.length > 0) {
    base.push("Each agentId must be one of:");
    for (const agent of routableAgents) {
      base.push(`- ${agent.id}: ${agent.description}`);
    }
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
      prompt: z
        .string()
        .transform(normalizeDelegationPrompt)
        .describe(
          "Self-contained task for this specialist. Required and must be non-empty. Match the user's scope exactly: preserve operation, dates/targets, note paths, and constraints (only/don't/no other). Do not add carry-over or extra tasks unless asked.",
        ),
    })
    : z.object({
      agentId: z.string(),
      prompt: z.string().transform(normalizeDelegationPrompt),
    });

  return z.object({
    next: z.enum(routeNames).describe(buildRoutingDescription(routableAgents)),
    prompt: z
      .string()
      .optional()
      .transform(normalizeDelegationPrompt)
      .describe(
        "Self-contained task for the specialist when routing via next alone. Required when next is a runtime agent and queue is omitted. Match the user's scope exactly: preserve operation, dates/targets, note paths, and constraints (only/don't/no other). Do not add carry-over or extra tasks unless asked.",
      ),
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
