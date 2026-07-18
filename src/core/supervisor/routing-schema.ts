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

const buildRoutingDescription = (runtimeAgents: RuntimeAgentDefinition[]): string => {
  const base = [
    "The next graph node to execute.",
    "Use FINISH for general chat or any request you can answer directly.",
  ];

  const enabledAgents = runtimeAgents.filter((agent) => agent.enabled);
  if (enabledAgents.length > 0) {
    base.push("Route to a runtime agent id when the request clearly matches one of these specialists:");
    for (const agent of enabledAgents) {
      base.push(`- ${agent.id}: ${agent.description}`);
    }
  }

  return base.join(" ");
};

export const buildSupervisorRoutingSchema = (runtimeAgents: RuntimeAgentDefinition[] = []) => {
  const enabledAgentIds = runtimeAgents
    .filter((agent) => agent.enabled)
    .map((agent) => agent.id);

  const routeNames = [...BUILTIN_SUPERVISOR_ROUTES, ...enabledAgentIds] as [string, ...string[]];

  return z.object({
    next: z.enum(routeNames).describe(buildRoutingDescription(runtimeAgents)),
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
