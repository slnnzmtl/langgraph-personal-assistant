import { DATA_WRITES_DISABLED_MESSAGE } from "../../core/persistence/read-only-repositories.js";
import type { CronJobDefinition, CronJobRepository } from "./types.js";

const rejectWrite = (): never => {
  throw new Error(DATA_WRITES_DISABLED_MESSAGE);
};

export const createReadOnlyCronJobRepository = (
  repository: CronJobRepository,
): CronJobRepository => ({
  loadJobs: () => repository.loadJobs(),
  saveJobs: async () => rejectWrite(),
  createJob: async (_job: CronJobDefinition) => rejectWrite(),
  deleteJob: async (_jobName: string) => rejectWrite(),
});
