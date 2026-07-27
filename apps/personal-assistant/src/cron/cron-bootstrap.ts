import type { AppConfig } from "../config.js";
import type { CronJobRepository } from "./cron-job-repository.js";
import { validateCronJobs, type CronJobDefinition } from "./cron-launcher.js";
import type { RuntimeCronService } from "./types.js";

export const startCronBootstrap = async (options: {
	repository: CronJobRepository;
	config: Pick<AppConfig, "appTimezone" | "schedulerEnabled">;
	runtimeCron?: RuntimeCronService;
	cronTargetAgentIds?: readonly string[];
}): Promise<CronJobDefinition[]> => {
	const jobs = await options.repository.loadJobs();

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
