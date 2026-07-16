import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

const CRON_TRIGGER_PREFIX = "SYSTEM_CRON_TRIGGER:";
const ROUTE_TRIGGER_SEPARATOR = ":";

export const SUPERVISE_CRON_ROUTE = "Supervise_SG" as const;
export type CronTargetRoute = string;

export type CronTriggerResolver = {
  isCronTargetRoute: (value: string) => value is CronTargetRoute;
  resolveCronTriggerRoute: (message: BaseMessage | undefined) => CronTargetRoute | null;
  buildCronTriggerForJob: (targetRoute: CronTargetRoute, jobName: string) => string;
};

export const createCronTriggerResolver = (
  allowedAgentIds: readonly string[],
): CronTriggerResolver => {
  const cronTargetRoutes = new Set<string>([
    ...allowedAgentIds,
    SUPERVISE_CRON_ROUTE,
  ]);

  const isCronTargetRoute = (value: string): value is CronTargetRoute =>
    cronTargetRoutes.has(value);

  const resolveCronTriggerRoute = (message: BaseMessage | undefined): CronTargetRoute | null => {
    if (!message) {
      return null;
    }

    const text = extractTextContent(message);
    const triggerText = text?.split(/\r?\n/, 1)[0]?.trim();
    if (!triggerText?.startsWith(CRON_TRIGGER_PREFIX)) {
      return null;
    }

    const triggerName = triggerText.slice(CRON_TRIGGER_PREFIX.length).trim();
    const derivedRoute = triggerName.split(ROUTE_TRIGGER_SEPARATOR, 1)[0];
    if (derivedRoute && isCronTargetRoute(derivedRoute)) {
      return derivedRoute;
    }

    return null;
  };

  const buildCronTriggerForJob = (targetRoute: CronTargetRoute, jobName: string): string =>
    `${CRON_TRIGGER_PREFIX}${targetRoute}${ROUTE_TRIGGER_SEPARATOR}${jobName}`;

  return {
    isCronTargetRoute,
    resolveCronTriggerRoute,
    buildCronTriggerForJob,
  };
};

const extractTextContent = (message: BaseMessage): string | null => {
  if (!(message instanceof HumanMessage)) {
    return null;
  }

  return typeof message.content === "string" ? message.content.trim() : null;
};

export const buildCronTriggerForJob = (targetRoute: CronTargetRoute, jobName: string): string =>
  createCronTriggerResolver([]).buildCronTriggerForJob(targetRoute, jobName);

export const resolveCronTriggerRoute = (
  message: BaseMessage | undefined,
  allowedAgentIds: readonly string[] = [],
): CronTargetRoute | null =>
  createCronTriggerResolver(allowedAgentIds).resolveCronTriggerRoute(message);

export const isCronTargetRoute = (
  value: string,
  allowedAgentIds: readonly string[] = [],
): value is CronTargetRoute =>
  createCronTriggerResolver(allowedAgentIds).isCronTargetRoute(value);
