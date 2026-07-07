import "dotenv/config";

import { loadConfig, type AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createWorkflowGraph } from "./graph/workflow-graph.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";
import { bootstrapFinanceRuntime, createSupabaseDbClient } from "./packages/finance-server/src/index.js";
import type { FinanceRepository } from "./nodes/finance-node/src/index.js";

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);

	// Optional: Set up finance runtime if Supabase credentials are provided and enabled
	let financeRepository: FinanceRepository | undefined;
	if (config.enableFinanceSync && config.supabaseUrl && config.supabaseServiceRoleKey) {
		try {
			const dbClient = createSupabaseDbClient(config.supabaseUrl, config.supabaseServiceRoleKey);
			financeRepository = await bootstrapFinanceRuntime(dbClient);
			console.log("Finance runtime bootstrapped with Supabase backend.");
		} catch (error) {
			console.error("Failed to bootstrap finance runtime:", error);
			// Continue without finance sync rather than failing the entire app
		}
	}

	const graphConfig: Pick<AppConfig, "obsidianVaultPath" | "appTimezone"> & { financeRepository?: FinanceRepository } = {
		obsidianVaultPath: config.obsidianVaultPath,
		appTimezone: config.appTimezone,
	};
	if (financeRepository) {
		graphConfig.financeRepository = financeRepository;
	}

	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, graphConfig);
	const telegramAdapter = new TelegramAdapter(app, config);

	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});