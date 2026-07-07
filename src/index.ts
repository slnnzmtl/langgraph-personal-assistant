import "dotenv/config";

import { loadConfig, type AppConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createWorkflowGraph } from "./graph/workflow-graph.js";
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

	const graphConfig: Pick<AppConfig, "obsidianVaultPath" | "appTimezone"> & { supabaseSession?: SupabaseMcpSession } = {
		obsidianVaultPath: config.obsidianVaultPath,
		appTimezone: config.appTimezone,
	};
	if (supabaseSession) {
		graphConfig.supabaseSession = supabaseSession;
	}

	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, financeConnector, graphConfig);
	const telegramAdapter = new TelegramAdapter(app, config);

	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});