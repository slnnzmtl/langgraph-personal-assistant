import { z } from "zod";

import type { RuntimeAgentDefinition } from "../types/agent.js";

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
      .describe(
        "The conversational response sent back to the user. Include this whenever 'next' is 'FINISH'. Omit it when routing to a runtime agent.",
      ),
  });
};

export type RoutingDecision = z.infer<ReturnType<typeof buildSupervisorRoutingSchema>>;
