import type { AppConfig } from "../config.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import { validateCronJobs, type CronJobDefinition } from "./cron-launcher.js";
import type { RuntimeCronService } from "./types.js";

export const buildDefaultCronJobs = (): CronJobDefinition[] => [];

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
}): Promise<CronJobDefinition[]> => {
	const defaultJobs = buildDefaultCronJobs();
	const persistedJobs = await options.repository.loadJobs();

	return mergeCronJobs(defaultJobs, persistedJobs);
};

export const startCronBootstrap = async (options: {
	repository: CronJobRepository;
	config: Pick<AppConfig, "appTimezone" | "schedulerEnabled">;
	runtimeCron?: RuntimeCronService;
	cronTargetAgentIds?: readonly string[];
}): Promise<CronJobDefinition[]> => {
	const jobs = await loadCronJobsForStartup({
		repository: options.repository,
	});

	validateCronJobs(jobs, options.cronTargetAgentIds ?? []);

	if (!jobs.length || !options.config.schedulerEnabled || !options.runtimeCron) {
		return jobs;
	}

	for (const job of jobs) {
		if (job.enabled === false) {
			continue;
		}

		await options.runtimeCron.addJob(job);
	}

	return jobs;
};
