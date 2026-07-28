import { watch } from "node:fs";
import path from "node:path";

import { reconcileRuntimeCron } from "./reconcile-runtime-cron.js";
import type { CronJobRepository } from "./types.js";
import type { RuntimeCronService } from "./runtime-cron-service.js";

const RECONCILE_DEBOUNCE_MS = 250;

export type CronJobWatcher = {
  close(): void;
};

export const watchCronJobDefinitions = (
  cronJobsFilePath: string,
  options: {
    repository: CronJobRepository;
    runtimeCron: RuntimeCronService;
  },
): CronJobWatcher => {
  let reconcileTimer: NodeJS.Timeout | undefined;
  const watchedFileName = path.basename(cronJobsFilePath);
  const watchedDirectory = path.dirname(cronJobsFilePath);

  const scheduleReconcile = (): void => {
    if (reconcileTimer) {
      clearTimeout(reconcileTimer);
    }

    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined;
      void reconcileRuntimeCron(options.repository, options.runtimeCron).catch((error: unknown) => {
        console.error("[Cron] Failed to reconcile jobs after file change:", error);
      });
    }, RECONCILE_DEBOUNCE_MS);
  };

  const watcher = watch(watchedDirectory, (event, filename) => {
    if (filename === watchedFileName) {
      scheduleReconcile();
    }
  });

  return {
    close() {
      watcher.close();
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
      }
    },
  };
};
