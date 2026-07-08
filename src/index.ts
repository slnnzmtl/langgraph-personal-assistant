import "dotenv/config";

import cron from "node-cron";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createCronJobRepository } from "./cron/cron-job-repository.js";
import type { CronJobDefinition } from "./cron/cron-launcher.js";
import { validateCronJobs, buildSchedulerTriggerForJob } from "./cron/cron-launcher.js";
import { createLazySchedulerService, createRuntimeSchedulerService } from "./cron/runtime-scheduler-service.js";
import { createSchedulerRunner } from "./cron/scheduler-runner.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "./graph/workflow-graph.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { bootstrapFinanceRuntimeWithOfficialMcp } from "./packages/finance-server/src/index.js";
import type { SupabaseMcpSession } from "./packages/finance-server/src/index.js";

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

	// Optional: Set up Supabase MCP session if finance sync is enabled and credentials provided
	let supabaseSession: SupabaseMcpSession | undefined;
	console.log("[Finance Setup] Checking finance sync configuration:");
	console.log(`  enableFinanceSync: ${config.enableFinanceSync}`);
	console.log(`  supabaseProjectRef: ${config.supabaseProjectRef ? "SET" : "MISSING"}`);
	console.log(`  supabaseAccessToken: ${config.supabaseAccessToken ? "SET" : "MISSING"}`);
	
	if (config.enableFinanceSync && config.supabaseProjectRef && config.supabaseAccessToken) {
		try {
			console.log("[Finance Setup] All credentials present, creating Supabase MCP session...");
			supabaseSession = await bootstrapFinanceRuntimeWithOfficialMcp({
				url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
				projectRef: config.supabaseProjectRef,
				accessToken: config.supabaseAccessToken,
				// Finance sync needs write access for INSERT
				readOnly: false,
			});
			console.log("[Finance Setup] ✓ Supabase MCP session created successfully.");
		} catch (error) {
			console.error("[Finance Setup] ✗ Failed to create Supabase session:", error);
			// Continue without finance sync rather than failing the entire app
		}
	} else {
		console.log("[Finance Setup] ✗ Skipping finance sync setup - missing required configuration.");
	}

	// Build default cron jobs inline
	const buildDefaultJobs = (): CronJobDefinition[] => {
		return [
			{
				jobName: "finance-sync",
				schedule: config.financeSyncCron,
				targetRoute: "Finance_SG",
				...(config.appTimezone !== "UTC" ? { timezone: config.appTimezone } : {}),
			},
		];
	};

	// Load persisted jobs and merge with defaults inline
	const cronJobRepository = createCronJobRepository(process.cwd(), path.relative(process.cwd(), config.cronJobsFilePath));
	const defaultJobs = buildDefaultJobs();
	let allJobs = defaultJobs;

	try {
		const persistedJobs = await cronJobRepository.loadJobs();
		// Merge: persisted jobs override defaults by jobName
		const jobMap = new Map<string, CronJobDefinition>();
		for (const job of defaultJobs) {
			jobMap.set(job.jobName, job);
		}
		for (const job of persistedJobs) {
			jobMap.set(job.jobName, job);
		}
		allJobs = Array.from(jobMap.values());
		console.log(`[Scheduler] Loaded ${persistedJobs.length} persisted cron jobs, merged with ${defaultJobs.length} defaults for total of ${allJobs.length} jobs.`);
	} catch (error) {
		console.warn("[Scheduler] Could not load persisted cron jobs, using defaults only:", error instanceof Error ? error.message : String(error));
	}

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
		runner: async (trigger: string) => {
			const jobName = trigger.split(":")[2] || "unknown";
			await schedulerRunner.run({ jobName, trigger });
		},
		timezone: config.appTimezone,
	});

	// Initialize the lazy scheduler with the real service
	lazySchedulerService.setService(runtimeSchedulerService);

	// Validate all jobs
	try {
		validateCronJobs(allJobs);
	} catch (error) {
		console.error("[Scheduler] Job validation failed:", error instanceof Error ? error.message : String(error));
		throw error;
	}

	// Schedule all jobs directly using cron
	if (config.schedulerEnabled) {
		for (const job of allJobs) {
			if (job.enabled === false) {
				continue;
			}

			const trigger = buildSchedulerTriggerForJob(job.targetRoute, job.jobName);
			cron.schedule(
				job.schedule,
				async () => {
					await schedulerRunner.run({
						jobName: job.jobName,
						trigger,
					});
				},
				{ timezone: job.timezone ?? config.appTimezone },
			);

			console.log(`[Scheduler] Scheduled job: ${job.jobName} (${job.schedule})`);
		}
		console.log(`[Scheduler] Started ${allJobs.length} cron jobs.`);
	} else {
		console.log("[Scheduler] Scheduler is disabled.");
	}

	const telegramAdapter = new TelegramAdapter(app, config);
	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});