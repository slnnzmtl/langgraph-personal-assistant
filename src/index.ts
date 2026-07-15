import "dotenv/config";

import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createLazyCron, startCron } from "./cron/cron-startup.js";
import { createCronJobRepositoryForConfig } from "./cron/cron-job-repository.js";
import { createWorkflowGraph, type WorkflowGraphConfig } from "./agent.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { TelegramFileSender } from "./telegram/file-sender.js";
import { setupSupabaseSession } from "./services/supabase.js";
import type { SupabaseMcpSession } from "./mcp/supabase.js";

const main = async (): Promise<void> => {
	const config = loadConfig();
	const bot = new Telegraf(config.telegramBotToken);
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const financeConnector = new GeminiConnector(config.googleApiKey, config.financeModel);

	const supabaseSession: SupabaseMcpSession | undefined = await setupSupabaseSession(config);
	const cronJobRepository = createCronJobRepositoryForConfig(config.cronJobsFilePath);
	const fileSender = new TelegramFileSender(bot.telegram);
	const lazyCron = createLazyCron();

	const graphConfig: WorkflowGraphConfig = {
		obsidianVaultPath: config.obsidianVaultPath,
		cronJobRepository,
		runtimeCron: lazyCron,
		fileSender,
	};
	if (supabaseSession) {
		graphConfig.supabaseSession = supabaseSession;
	}

	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, financeConnector, graphConfig);

	await startCron({
		graph: app,
		summaryModel: supervisorConnector.getModel(),
		config,
		lazyCron,
		cronJobRepository,
		telegram: bot.telegram,
	});

	const telegramAdapter = new TelegramAdapter(app, config, bot, fileSender);
	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});
