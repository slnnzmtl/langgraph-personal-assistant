import { describe, expect, it, vi } from "vitest";

import { buildDefaultCronJobs, mergeCronJobs, startCronBootstrap } from "../../src/cron/cron-bootstrap.js";

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

describe("mergeCronJobs", () => {
	it("lets persisted jobs override defaults by job name", () => {
		const jobs = mergeCronJobs(
			[
				{
					jobName: "finance-sync",
					schedule: "59 23 * * *",
					targetRoute: "Finance_SG",
				},
			],
			[
				{
					jobName: "finance-sync",
					schedule: "0 1 * * *",
					targetRoute: "Finance_SG",
					timezone: "America/New_York",
				},
			],
		);

		expect(jobs).toEqual([
			{
				jobName: "finance-sync",
				schedule: "0 1 * * *",
				targetRoute: "Finance_SG",
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
					targetRoute: "Finance_SG",
				},
			]),
			saveJobs: vi.fn(),
		};

		await expect(
			startCronBootstrap({
				repository,
				config: {
					financeSyncCron: "59 23 * * *",
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
					jobName: "finance-sync",
					schedule: "59 23 * * *",
					targetRoute: "Finance_SG",
				},
			]),
			saveJobs: vi.fn(),
		};
		const schedule = vi.fn();
		const run = vi.fn();

		const jobs = await startCronBootstrap({
			repository,
			config: {
				financeSyncCron: "59 23 * * *",
				appTimezone: "UTC",
				schedulerEnabled: false,
			},
			runner: { run },
			schedule,
		});

		expect(jobs).toEqual([
			{
				jobName: "finance-sync",
				schedule: "59 23 * * *",
				targetRoute: "Finance_SG",
			},
		]);
		expect(schedule).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(repository.loadJobs).toHaveBeenCalledTimes(1);
	});

	it("schedules validated jobs when enabled", async () => {
		const repository = {
			loadJobs: vi.fn().mockResolvedValue([]),
			saveJobs: vi.fn(),
		};
		const schedule = vi.fn();
		const run = vi.fn().mockResolvedValue(undefined);

		const jobs = await startCronBootstrap({
			repository,
			config: {
				financeSyncCron: "59 23 * * *",
				appTimezone: "UTC",
				schedulerEnabled: true,
			},
			runner: { run },
			schedule,
		});

		expect(jobs).toEqual([
			{
				jobName: "finance-sync",
				schedule: "59 23 * * *",
				targetRoute: "Finance_SG",
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