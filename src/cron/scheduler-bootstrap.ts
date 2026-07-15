import path from "node:path";
import cron from "node-cron";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AppConfig } from "../config.js";
import { createTelegramCronReporter } from "../telegram/telegram-cron-reporter.js";
import { startCronBootstrap } from "./cron-bootstrap.js";
import { createCronJobRepository } from "./cron-job-repository.js";
import { createLazySchedulerService, createRuntimeSchedulerService } from "./runtime-scheduler-service.js";
import { createSchedulerRunner, type SchedulerJobRun } from "./scheduler-runner.js";

export type LazySchedulerService = ReturnType<typeof createLazySchedulerService>;

export const createLazyScheduler = (): LazySchedulerService => createLazySchedulerService();

type GraphInvoker = {
	invoke(input: unknown, config?: unknown): Promise<unknown>;
};

export type StartSchedulerOptions = {
	graph: GraphInvoker;
	summaryModel: BaseChatModel;
	config: AppConfig;
	lazyScheduler: LazySchedulerService;
};

export const startScheduler = async (options: StartSchedulerOptions): Promise<void> => {
	const { graph, summaryModel, config, lazyScheduler } = options;

	const onJobError = (error: unknown, context: SchedulerJobRun): void => {
		console.error(`[Scheduler] Job failed: ${context.jobName}`, error);
	};

	const cronReporter = createTelegramCronReporter({
		telegramBotToken: config.telegramBotToken,
		chatId: config.allowedTelegramUserId,
	});

	const schedulerRunner = createSchedulerRunner({
		graph,
		summaryModel,
		onError: onJobError,
		reporter: cronReporter,
	});

	const runtimeSchedulerService = createRuntimeSchedulerService({
		runner: async (job) => {
			await schedulerRunner.run(job);
		},
		timezone: config.appTimezone,
	});

	lazyScheduler.setService(runtimeSchedulerService);

	const cronJobRepository = createCronJobRepository(process.cwd(), path.relative(process.cwd(), config.cronJobsFilePath));
	await startCronBootstrap({
		repository: cronJobRepository,
		config: {
			appTimezone: config.appTimezone,
			schedulerEnabled: config.schedulerEnabled,
		},
		runner: schedulerRunner,
		schedule: cron.schedule.bind(cron),
	});
};
