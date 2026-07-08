import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { ROUTE_NAMES, type RouteName } from "../state.js";

const SCHEDULER_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export type SchedulerTargetRoute = Exclude<RouteName, "FINISH">;

const SCHEDULER_TRIGGER_ROUTES: Record<string, SchedulerTargetRoute> = {
  "finance-sync": "Finance_SG",
  "obsidian-daily-note": "Obsidian_SG",
};

const SCHEDULER_TARGET_ROUTES = new Set<RouteName>(ROUTE_NAMES.filter((routeName) => routeName !== "FINISH"));

const extractTextContent = (message: BaseMessage): string | null => {
  if (!(message instanceof HumanMessage)) {
    return null;
  }

  return typeof message.content === "string" ? message.content.trim() : null;
};

export const isSchedulerTargetRoute = (value: string): value is SchedulerTargetRoute =>
  SCHEDULER_TARGET_ROUTES.has(value as RouteName);

export const resolveSchedulerTriggerRoute = (message: BaseMessage | undefined): RouteName | null => {
  if (!message) {
    return null;
  }

  const text = extractTextContent(message);
  if (!text?.startsWith(SCHEDULER_TRIGGER_PREFIX)) {
    return null;
  }

  const triggerName = text.slice(SCHEDULER_TRIGGER_PREFIX.length).trim();
  const legacyRoute = SCHEDULER_TRIGGER_ROUTES[triggerName];
  if (legacyRoute) {
    return legacyRoute;
  }

  const derivedRoute = triggerName.split(ROUTE_TRIGGER_SEPARATOR, 1)[0];
  if (derivedRoute && isSchedulerTargetRoute(derivedRoute)) {
    return derivedRoute as SchedulerTargetRoute;
  }

  return null;
};

export const buildSchedulerTrigger = (triggerName: keyof typeof SCHEDULER_TRIGGER_ROUTES): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${triggerName}`;

export const buildSchedulerTriggerForJob = (targetRoute: SchedulerTargetRoute, jobName: string): string =>
  `${SCHEDULER_TRIGGER_PREFIX}${targetRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;