import "dotenv/config";

import cron from "node-cron";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createCronJobRepository } from "./cron/cron-job-repository.js";
import { startCronBootstrap } from "./cron/cron-bootstrap.js";
import { createLazySchedulerService, createRuntimeSchedulerService } from "./cron/runtime-scheduler-service.js";
import { createSchedulerRunner, type SchedulerJobRun } from "./cron/scheduler-runner.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "./graph/workflow-graph.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { createTelegramCronReporter } from "./telegram/telegram-cron-reporter.js";
import { setupFinanceDatabase } from "./nodes/finance-node/tools/supabase/index.js";
import type { SupabaseMcpSession } from "./mcp/supabase/index.js";

// Finance session setup moved to `src/nodes/finance-node/session.ts`

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

	const supabaseSession: SupabaseMcpSession | undefined = await setupFinanceDatabase(config);

	// Use lazy scheduler since graph is built before runner is ready
	const lazySchedulerService = createLazySchedulerService();
	const graphConfig: WorkflowGraphConfig = {
		obsidianVaultPath: config.obsidianVaultPath,
		appTimezone: config.appTimezone,
		cronJobsFilePath: config.cronJobsFilePath,
		runtimeScheduler: lazySchedulerService,
	};
	if (supabaseSession) {
		graphConfig.supabaseSession = supabaseSession;
	}

	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, financeConnector, graphConfig);

	// Create runner and runtime scheduler service
	const onJobError = (error: unknown, context: SchedulerJobRun): void => {
		console.error(`[Scheduler] Job failed: ${context.jobName}`, error);
	};

	const cronReporter = createTelegramCronReporter({
		telegramBotToken: config.telegramBotToken,
		chatId: config.allowedTelegramUserId,
	});

	const schedulerRunner = createSchedulerRunner({
		graph: app,
		summaryModel: supervisorConnector.getModel(),
		onError: onJobError,
		reporter: cronReporter,
	});

	const runtimeSchedulerService = createRuntimeSchedulerService({
		runner: async (job) => {
			await schedulerRunner.run(job);
		},
		timezone: config.appTimezone,
	});

	// Initialize the lazy scheduler with the real service
	lazySchedulerService.setService(runtimeSchedulerService);

	const cronJobRepository = createCronJobRepository(process.cwd(), path.relative(process.cwd(), config.cronJobsFilePath));
	await startCronBootstrap({
		repository: cronJobRepository,
		config: {
			financeSyncCron: config.financeSyncCron,
			appTimezone: config.appTimezone,
			schedulerEnabled: config.schedulerEnabled,
		},
		runner: schedulerRunner,
		schedule: cron.schedule.bind(cron),
	});

	const telegramAdapter = new TelegramAdapter(app, config);
	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});