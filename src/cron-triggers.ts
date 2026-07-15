import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import type { RouteName } from "./state.js";

const CRON_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export const SUPERVISE_CRON_ROUTE = "Supervise_SG" as const;
export type CronTargetRoute = Exclude<RouteName, "FINISH"> | typeof SUPERVISE_CRON_ROUTE;

const LEGACY_CRON_TRIGGER_ROUTES: Record<string, CronTargetRoute> = {
  "finance-sync": "Finance_SG",
  "obsidian-daily-note": "Obsidian_SG",
};

const CRON_TARGET_ROUTES = new Set<string>(["Finance_SG", "Obsidian_SG", "Config_SG", SUPERVISE_CRON_ROUTE]);

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
    return derivedRoute;
  }

  return null;
};

export const buildCronTrigger = (triggerName: keyof typeof LEGACY_CRON_TRIGGER_ROUTES): string =>
  `${CRON_TRIGGER_PREFIX}${triggerName}`;

export const buildCronTriggerForJob = (targetRoute: CronTargetRoute, jobName: string): string =>
  `${CRON_TRIGGER_PREFIX}${targetRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;
