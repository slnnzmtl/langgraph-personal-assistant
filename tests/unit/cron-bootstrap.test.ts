import { describe, expect, it, vi } from "vitest";

import { buildDefaultCronJobs, mergeCronJobs, startCronBootstrap } from "../../src/cron/cron-bootstrap.js";

describe("buildDefaultCronJobs", () => {
	it("returns no default jobs", () => {
		expect(buildDefaultCronJobs()).toEqual([]);
	});
});

describe("mergeCronJobs", () => {
	it("lets persisted jobs override defaults by job name", () => {
		const jobs = mergeCronJobs(
			[
				{
					jobName: "daily-report",
					schedule: "59 23 * * *",
					targetRoute: "finance",
				},
			],
			[
				{
					jobName: "daily-report",
					schedule: "0 1 * * *",
					targetRoute: "finance",
					timezone: "America/New_York",
				},
			],
		);

		expect(jobs).toEqual([
			{
				jobName: "daily-report",
				schedule: "0 1 * * *",
				targetRoute: "finance",
				timezone: "America/New_York",
			},
		]);
	});
});

describe("startCronBootstrap", () => {
	it("rejects invalid cron jobs even when scheduling is disabled", async () => {
		const repository = {
			loadJobs: vi.fn().mockResolvedValue([
				{
					jobName: "",
					schedule: "59 23 * * *",
					targetRoute: "finance",
				},
			]),
			saveJobs: vi.fn(),
		};

		await expect(
			startCronBootstrap({
				repository,
				config: {
					appTimezone: "UTC",
					schedulerEnabled: false,
				},
				runner: { run: vi.fn() },
				schedule: vi.fn(),
			}),
		).rejects.toThrow(/cron job name is required/i);

		expect(repository.loadJobs).toHaveBeenCalledTimes(1);
	});

	it("validates jobs before scheduling and skips scheduling when disabled", async () => {
		const repository = {
			loadJobs: vi.fn().mockResolvedValue([
				{
					jobName: "daily-report",
					schedule: "59 23 * * *",
					targetRoute: "finance",
				},
			]),
			saveJobs: vi.fn(),
		};
		const schedule = vi.fn();
		const run = vi.fn();

		const jobs = await startCronBootstrap({
			repository,
			config: {
				appTimezone: "UTC",
				schedulerEnabled: false,
			},
			runner: { run },
			schedule,
		});

		expect(jobs).toEqual([
			{
				jobName: "daily-report",
				schedule: "59 23 * * *",
				targetRoute: "finance",
			},
		]);
		expect(schedule).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(repository.loadJobs).toHaveBeenCalledTimes(1);
	});

	it("schedules validated jobs when enabled", async () => {
		const repository = {
			loadJobs: vi.fn().mockResolvedValue([
				{
					jobName: "daily-report",
					schedule: "59 23 * * *",
					targetRoute: "finance",
				},
			]),
			saveJobs: vi.fn(),
		};
		const schedule = vi.fn();
		const run = vi.fn().mockResolvedValue(undefined);

		const jobs = await startCronBootstrap({
			repository,
			config: {
				appTimezone: "UTC",
				schedulerEnabled: true,
			},
			runner: { run },
			schedule,
		});

		expect(jobs).toEqual([
			{
				jobName: "daily-report",
				schedule: "59 23 * * *",
				targetRoute: "finance",
			},
		]);
		expect(schedule).toHaveBeenCalledTimes(1);
		expect(schedule).toHaveBeenCalledWith(
			"59 23 * * *",
			expect.any(Function),
			expect.objectContaining({ timezone: "UTC" }),
		);
	});
});
