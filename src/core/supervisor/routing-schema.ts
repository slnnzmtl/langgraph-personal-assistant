import { z } from "zod";

import type { RuntimeAgentDefinition } from "../types/agent.js";

const PLACEHOLDER_REPLY_VALUES = new Set(["null", "undefined", "none", "n/a"]);

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

  return z.object({
    next: z.enum(routeNames).describe(buildRoutingDescription(routableAgents)),
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
