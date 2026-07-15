import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import type { RouteName } from "../state.js";

const SCHEDULER_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export const SUPERVISE_SCHEDULER_ROUTE = "Supervise_SG" as const;
export type SchedulerTargetRoute = Exclude<RouteName, "FINISH"> | typeof SUPERVISE_SCHEDULER_ROUTE;

const SCHEDULER_TRIGGER_ROUTES: Record<string, SchedulerTargetRoute> = {
  "finance-sync": "Finance_SG",
  "obsidian-daily-note": "Obsidian_SG",
};

const SCHEDULER_TARGET_ROUTES = new Set<string>(["Finance_SG", "Obsidian_SG", "Config_SG", SUPERVISE_SCHEDULER_ROUTE]);

const extractTextContent = (message: BaseMessage): string | null => {
  if (!(message instanceof HumanMessage)) {
    return null;
  }

  return typeof message.content === "string" ? message.content.trim() : null;
};

export const isSchedulerTargetRoute = (value: string): value is SchedulerTargetRoute =>
  SCHEDULER_TARGET_ROUTES.has(value);

export const resolveSchedulerTriggerRoute = (message: BaseMessage | undefined): SchedulerTargetRoute | null => {
  if (!message) {
    return null;
  }

  const text = extractTextContent(message);
  const triggerText = text?.split(/\r?\n/, 1)[0]?.trim();
  if (!triggerText?.startsWith(SCHEDULER_TRIGGER_PREFIX)) {
    return null;
  }

  const triggerName = triggerText.slice(SCHEDULER_TRIGGER_PREFIX.length).trim();
  const legacyRoute = SCHEDULER_TRIGGER_ROUTES[triggerName];
  if (legacyRoute) {
    return legacyRoute;
  }

  const derivedRoute = triggerName.split(ROUTE_TRIGGER_SEPARATOR, 1)[0];
  if (derivedRoute && isSchedulerTargetRoute(derivedRoute)) {
    return derivedRoute;
  }

  return null;
};

export const buildSchedulerTrigger = (triggerName: keyof typeof SCHEDULER_TRIGGER_ROUTES): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${triggerName}`;

export const buildSchedulerTriggerForJob = (targetRoute: SchedulerTargetRoute, jobName: string): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${targetRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;
