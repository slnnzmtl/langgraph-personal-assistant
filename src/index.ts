import "dotenv/config";

import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createLazyScheduler, startScheduler } from "./cron/scheduler-bootstrap.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "./agent.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";
import { setupSupabaseSession } from "./services/supabase.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

	const supabaseSession: SupabaseMcpSession | undefined = await setupSupabaseSession(config);

	const fileSender = new TelegramFileSender(new Telegraf(config.telegramBotToken).telegram);

	// Use a lazy scheduler placeholder since the graph is built before the runner is ready
	const lazySchedulerService = createLazyScheduler();
	const graphConfig: WorkflowGraphConfig = {
		obsidianVaultPath: config.obsidianVaultPath,
		appTimezone: config.appTimezone,
		cronJobsFilePath: config.cronJobsFilePath,
		runtimeScheduler: lazySchedulerService,
		fileSender,
	};
	if (supabaseSession) {
		graphConfig.supabaseSession = supabaseSession;
	}

	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, financeConnector, graphConfig);

	await startScheduler({
		graph: app,
		summaryModel: supervisorConnector.getModel(),
		config,
		lazyScheduler: lazySchedulerService,
	});

	const telegramAdapter = new TelegramAdapter(app, config, fileSender);
	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});