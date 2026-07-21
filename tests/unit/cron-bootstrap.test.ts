import { describe, expect, it, vi } from "vitest";

import { buildDefaultCronJobs, mergeCronJobs, startCronBootstrap } from "../../src/cron/cron-bootstrap.js";
import { defaultTestCronTargetAgentIds } from "../helpers/runtime-agent-fixtures.js";
import type { RuntimeCronService } from "../../src/cron/types.js";

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
	const cronTargetAgentIds = defaultTestCronTargetAgentIds();

	const createRuntimeCronMock = (): RuntimeCronService & {
		addJob: ReturnType<typeof vi.fn>;
		removeJob: ReturnType<typeof vi.fn>;
		listActiveJobs: ReturnType<typeof vi.fn>;
	} => ({
		addJob: vi.fn().mockResolvedValue(undefined),
		removeJob: vi.fn().mockResolvedValue(undefined),
		listActiveJobs: vi.fn().mockReturnValue([]),
	});

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
				runtimeCron: createRuntimeCronMock(),
				cronTargetAgentIds,
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
		const runtimeCron = createRuntimeCronMock();

		const jobs = await startCronBootstrap({
			repository,
			config: {
				appTimezone: "UTC",
				schedulerEnabled: false,
			},
			runtimeCron,
			cronTargetAgentIds,
		});

		expect(jobs).toEqual([
			{
				jobName: "daily-report",
				schedule: "59 23 * * *",
				targetRoute: "finance",
			},
		]);
		expect(runtimeCron.addJob).not.toHaveBeenCalled();
		expect(repository.loadJobs).toHaveBeenCalledTimes(1);
	});

	it("registers validated jobs through RuntimeCronService when enabled", async () => {
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
		const runtimeCron = createRuntimeCronMock();

		const jobs = await startCronBootstrap({
			repository,
			config: {
				appTimezone: "UTC",
				schedulerEnabled: true,
			},
			runtimeCron,
			cronTargetAgentIds,
		});

		expect(jobs).toEqual([
			{
				jobName: "daily-report",
				schedule: "59 23 * * *",
				targetRoute: "finance",
			},
		]);
		expect(runtimeCron.addJob).toHaveBeenCalledTimes(1);
		expect(runtimeCron.addJob).toHaveBeenCalledWith({
			jobName: "daily-report",
			schedule: "59 23 * * *",
			targetRoute: "finance",
		});
	});

	it("skips disabled jobs during bootstrap registration", async () => {
		const repository = {
			loadJobs: vi.fn().mockResolvedValue([
				{
					jobName: "daily-report",
					schedule: "59 23 * * *",
					targetRoute: "finance",
					enabled: false,
				},
			]),
			saveJobs: vi.fn(),
		};
		const runtimeCron = createRuntimeCronMock();

		await startCronBootstrap({
			repository,
			config: {
				appTimezone: "UTC",
				schedulerEnabled: true,
			},
			runtimeCron,
			cronTargetAgentIds,
		});

		expect(runtimeCron.addJob).not.toHaveBeenCalled();
	});
});
