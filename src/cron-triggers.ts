import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import {
  BUILTIN_RUNTIME_AGENT_IDS,
  LEGACY_ROUTE_TO_AGENT_ID,
  resolveRuntimeAgentId,
  type BuiltinRuntimeAgentId,
} from "./runtime-agents/types.js";
import type { RouteName } from "./state.js";

const CRON_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export const SUPERVISE_CRON_ROUTE = "Supervise_SG" as const;
export type CronTargetRoute = BuiltinRuntimeAgentId | typeof SUPERVISE_CRON_ROUTE | keyof typeof LEGACY_ROUTE_TO_AGENT_ID;

const LEGACY_CRON_TRIGGER_ROUTES: Record<string, CronTargetRoute> = {
  "finance-sync": "finance",
  "obsidian-daily-note": "obsidian",
};

const CRON_TARGET_ROUTES = new Set<string>([
  ...BUILTIN_RUNTIME_AGENT_IDS,
  ...Object.keys(LEGACY_ROUTE_TO_AGENT_ID),
  SUPERVISE_CRON_ROUTE,
]);

const extractTextContent = (message: BaseMessage): string | null => {
  if (!(message instanceof HumanMessage)) {
    return null;
  }

  return typeof message.content === "string" ? message.content.trim() : null;
};

export const isCronTargetRoute = (value: string): value is CronTargetRoute =>
  CRON_TARGET_ROUTES.has(value);

export const resolveCronTriggerRoute = (message: BaseMessage | undefined): CronTargetRoute | null => {
  if (!message) {
    return null;
  }

  const text = extractTextContent(message);
  const triggerText = text?.split(/\r?\n/, 1)[0]?.trim();
  if (!triggerText?.startsWith(CRON_TRIGGER_PREFIX)) {
    return null;
  }

  const triggerName = triggerText.slice(CRON_TRIGGER_PREFIX.length).trim();
  const legacyRoute = LEGACY_CRON_TRIGGER_ROUTES[triggerName];
  if (legacyRoute) {
    return legacyRoute;
  }

  const derivedRoute = triggerName.split(ROUTE_TRIGGER_SEPARATOR, 1)[0];
  if (derivedRoute && isCronTargetRoute(derivedRoute)) {
    return resolveRuntimeAgentId(derivedRoute) as CronTargetRoute;
  }

  return null;
};

export const buildCronTrigger = (triggerName: keyof typeof LEGACY_CRON_TRIGGER_ROUTES): string =>
  `${CRON_TRIGGER_PREFIX}${triggerName}`;

export const buildCronTriggerForJob = (targetRoute: CronTargetRoute, jobName: string): string => {
  const normalizedRoute = resolveRuntimeAgentId(targetRoute);
  return `${CRON_TRIGGER_PREFIX}${normalizedRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;
};
