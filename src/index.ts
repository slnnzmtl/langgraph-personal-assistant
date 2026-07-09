import "dotenv/config";

import cron from "node-cron";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createCronJobRepository } from "./cron/cron-job-repository.js";
import { startCronBootstrap } from "./cron/cron-bootstrap.js";
import { createLazySchedulerService, createRuntimeSchedulerService } from "./cron/runtime-scheduler-service.js";
import { createSchedulerRunner } from "./cron/scheduler-runner.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "./graph/workflow-graph.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { bootstrapFinanceRuntimeWithOfficialMcp } from "./packages/finance-server/src/index.js";
import type { SupabaseMcpSession } from "./packages/finance-server/src/index.js";

const setupFinanceDatabaseSession = async (config: AppConfig): Promise<SupabaseMcpSession | undefined> => {
	if (config.enableFinanceSync && config.supabaseProjectRef && config.supabaseAccessToken) {
		try {
			console.log("[Finance Setup] All credentials present, creating Supabase MCP session...");
			const session = await bootstrapFinanceRuntimeWithOfficialMcp({
				url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
				projectRef: config.supabaseProjectRef,
				accessToken: config.supabaseAccessToken,
				// Finance sync needs write access for INSERT
				readOnly: false,
			});
			console.log("[Finance Setup] ✓ Supabase MCP session created successfully.");
			return session;
		} catch (error) {
			console.error("[Finance Setup] ✗ Failed to create Supabase session:", error);
			// Continue without finance sync rather than failing the entire app
			return undefined;
		}
	} else {
		console.log("[Finance Setup] ✗ Skipping finance sync setup - missing required configuration.");
		return undefined;
	}
};

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

	const supabaseSession: SupabaseMcpSession | undefined = await setupFinanceDatabaseSession(config);

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
	const onJobError = (error: unknown, context: { jobName: string; trigger: string }): void => {
		console.error(`[Scheduler] Job failed: ${context.jobName}`, error);
	};

	const schedulerRunner = createSchedulerRunner({
		graph: app,
		onError: onJobError,
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