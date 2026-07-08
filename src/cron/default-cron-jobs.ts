import type { CronJobDefinition } from "./cron-launcher.js";

type DefaultCronJobConfig = {
  financeSyncCron: string;
};

export const buildDefaultCronJobs = (config: DefaultCronJobConfig): CronJobDefinition[] => {
  return [
    {
      jobName: "finance-sync",
      schedule: config.financeSyncCron,
      targetRoute: "Finance_SG",
    },
  ];
};