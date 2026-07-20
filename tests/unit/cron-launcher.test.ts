import { describe, expect, it, vi } from "vitest";

import { HumanMessage } from "@langchain/core/messages";

import { setupCron } from "../../src/cron/cron-launcher.js";
import { defaultTestCronTargetAgentIds } from "../helpers/runtime-agent-fixtures.js";
import {
  buildCronTriggerForJob,
  isCronTargetRoute,
  resolveCronTriggerRoute,
  SUPERVISE_CRON_ROUTE,
} from "../../src/cron-triggers.js";

describe("setupCron", () => {
  const cronTargetAgentIds = defaultTestCronTargetAgentIds();

  it("accepts the main supervisor as a cron target", () => {
    expect(isCronTargetRoute(SUPERVISE_CRON_ROUTE, cronTargetAgentIds)).toBe(true);
    expect(buildCronTriggerForJob(SUPERVISE_CRON_ROUTE, "morning-review")).toBe(
      "SYSTEM_CRON_TRIGGER:Supervise_SG:morning-review",
    );
    expect(resolveCronTriggerRoute(new HumanMessage("SYSTEM_CRON_TRIGGER:Supervise_SG:morning-review"), cronTargetAgentIds)).toBe(
      SUPERVISE_CRON_ROUTE,
    );
  });

  it("does not resolve legacy trigger names without an agent route prefix", () => {
    expect(resolveCronTriggerRoute(new HumanMessage("SYSTEM_CRON_TRIGGER:finance-sync"), cronTargetAgentIds)).toBeNull();
    expect(resolveCronTriggerRoute(new HumanMessage("SYSTEM_CRON_TRIGGER:obsidian-daily-note"), cronTargetAgentIds)).toBeNull();
  });

  it("registers enabled declarative jobs with the default timezone", () => {
    const schedule = vi.fn();
    const run = vi.fn();

    setupCron({
      enabled: true,
      defaultTimezone: "UTC",
      schedule,
      runner: { run },
      cronTargetAgentIds,
      jobs: [
        {
          jobName: "finance-sync",
          schedule: "59 23 * * *",
          targetRoute: "finance",
        },
      ],
    });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      "59 23 * * *",
      expect.any(Function),
      expect.objectContaining({ timezone: "UTC" }),
    );
  });

  it("does not register jobs when the scheduler is disabled", () => {
    const schedule = vi.fn();

    setupCron({
      enabled: false,
      defaultTimezone: "UTC",
      schedule,
      runner: { run: vi.fn() },
      cronTargetAgentIds,
      jobs: [
        {
          jobName: "finance-sync",
          schedule: "59 23 * * *",
          targetRoute: "finance",
        },
      ],
    });

    expect(schedule).not.toHaveBeenCalled();
  });

  it("skips disabled jobs and respects per-job timezone overrides", () => {
    const schedule = vi.fn();

    setupCron({
      enabled: true,
      defaultTimezone: "UTC",
      schedule,
      runner: { run: vi.fn() },
      cronTargetAgentIds,
      jobs: [
        {
          jobName: "finance-sync",
          schedule: "59 23 * * *",
          targetRoute: "finance",
          enabled: false,
        },
        {
          jobName: "obsidian-daily-note",
          schedule: "0 6 * * *",
          targetRoute: "obsidian",
          timezone: "America/New_York",
        },
      ],
    });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      "0 6 * * *",
      expect.any(Function),
      expect.objectContaining({ timezone: "America/New_York" }),
    );
  });

  it("runs the isolated derived trigger when the scheduled callback fires", async () => {
    const schedule = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);

    setupCron({
      enabled: true,
      defaultTimezone: "UTC",
      schedule,
      runner: { run },
      cronTargetAgentIds,
      jobs: [
        {
          jobName: "finance-sync",
          schedule: "59 23 * * *",
          targetRoute: "finance",
        },
      ],
    });

    const scheduledCallback = schedule.mock.calls[0]?.[1];
    expect(typeof scheduledCallback).toBe("function");

    await scheduledCallback();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      jobName: "finance-sync",
      trigger: "SYSTEM_CRON_TRIGGER:finance:finance-sync",
    });
  });

  it("forwards payload to the scheduler runner when present", async () => {
    const schedule = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);

    setupCron({
      enabled: true,
      defaultTimezone: "UTC",
      schedule,
      runner: { run },
      cronTargetAgentIds,
      jobs: [
        {
          jobName: "finance-sync",
          schedule: "59 23 * * *",
          targetRoute: "finance",
          payload: "Sync the Wise transactions for yesterday.",
        },
      ],
    });

    const scheduledCallback = schedule.mock.calls[0]?.[1];
    expect(typeof scheduledCallback).toBe("function");

    await scheduledCallback();

    expect(run).toHaveBeenCalledWith({
      jobName: "finance-sync",
      trigger: "SYSTEM_CRON_TRIGGER:finance:finance-sync",
      payload: "Sync the Wise transactions for yesterday.",
    });
  });

  it("rejects duplicate job names before registering schedules", () => {
    const schedule = vi.fn();

    expect(() =>
      setupCron({
        enabled: true,
        defaultTimezone: "UTC",
        schedule,
        runner: { run: vi.fn() },
        cronTargetAgentIds,
        jobs: [
          {
            jobName: "finance-sync",
            schedule: "59 23 * * *",
            targetRoute: "finance",
          },
          {
            jobName: "finance-sync",
            schedule: "0 6 * * *",
            targetRoute: "obsidian",
          },
        ],
      }),
    ).toThrow(/duplicate job name/i);

    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejects unknown target routes before registering schedules", () => {
    const schedule = vi.fn();

    expect(() =>
      setupCron({
        enabled: true,
        defaultTimezone: "UTC",
        schedule,
        runner: { run: vi.fn() },
        cronTargetAgentIds,
        jobs: [
          {
            jobName: "bad-job",
            schedule: "59 23 * * *",
            targetRoute: "Not_A_Real_Route" as never,
          },
        ],
      }),
    ).toThrow(/unknown target route/i);

    expect(schedule).not.toHaveBeenCalled();
  });
});