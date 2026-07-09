import type { AppConfig } from "../config.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import { setupCron, validateCronJobs, type CronJobDefinition } from "./cron-launcher.js";
import type { SchedulerRunner } from "./scheduler-runner.js";

type CronScheduleFn = (expression: string, task: () => void | Promise<void>, options?: { timezone?: string }) => unknown;

type DefaultCronJobConfig = {
	financeSyncCron: string;
};

export const buildDefaultCronJobs = (config: DefaultCronJobConfig): CronJobDefinition[] => [];

export const mergeCronJobs = (defaultJobs: CronJobDefinition[], persistedJobs: CronJobDefinition[]): CronJobDefinition[] => {
	const jobMap = new Map<string, CronJobDefinition>();

	for (const job of defaultJobs) {
		jobMap.set(job.jobName, job);
	}

	for (const job of persistedJobs) {
		jobMap.set(job.jobName, job);
	}

	return Array.from(jobMap.values());
};

export const loadCronJobsForStartup = async (options: {
	repository: CronJobRepository;
	config: Pick<AppConfig, "financeSyncCron" | "appTimezone" | "schedulerEnabled">;
}): Promise<CronJobDefinition[]> => {
	const defaultJobs = buildDefaultCronJobs({
		financeSyncCron: options.config.financeSyncCron,
	});
	const persistedJobs = await options.repository.loadJobs();

	return mergeCronJobs(defaultJobs, persistedJobs);
};

export const startCronBootstrap = async (options: {
	repository: CronJobRepository;
	config: Pick<AppConfig, "financeSyncCron" | "appTimezone" | "schedulerEnabled">;
	runner: SchedulerRunner;
	schedule: CronScheduleFn;
}): Promise<CronJobDefinition[]> => {
	const jobs = await loadCronJobsForStartup({
		repository: options.repository,
		config: options.config,
	});

	validateCronJobs(jobs);

	if (!jobs.length) {
		return jobs;
	}

	if (options.config.schedulerEnabled) {
		setupCron({
			enabled: true,
			defaultTimezone: options.config.appTimezone,
			schedule: options.schedule,
			runner: options.runner,
			jobs,
		});
	}

	return jobs;
};