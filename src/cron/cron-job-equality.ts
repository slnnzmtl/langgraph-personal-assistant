import type { CronJobDefinition } from "./cron-launcher.js";

export const cronJobsEqual = (left: CronJobDefinition, right: CronJobDefinition): boolean =>
  left.jobName === right.jobName
  && left.schedule === right.schedule
  && left.targetRoute === right.targetRoute
  && left.enabled === right.enabled
  && left.timezone === right.timezone
  && JSON.stringify(left.payload) === JSON.stringify(right.payload);
