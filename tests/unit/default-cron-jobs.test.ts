import { describe, expect, it } from "vitest";

import { buildDefaultCronJobs } from "../../src/cron/default-cron-jobs.js";

describe("buildDefaultCronJobs", () => {
  it("builds the default finance sync job from scheduler config", () => {
    const jobs = buildDefaultCronJobs({
      financeSyncCron: "59 23 * * *",
    });

    expect(jobs).toEqual([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "Finance_SG",
      },
    ]);
  });
});