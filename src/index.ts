import "dotenv/config";

import { loadConfig } from "./config.js";
import { GeminiConnector } from "./connectors/llm-connector.js";
import { createWorkflowGraph } from "./graph/workflow-graph.js";
import { TelegramAdapter } from "./telegram/telegram-adapter.js";

const main = async (): Promise<void> => {
	const config = loadConfig();
	const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
	const obsidianConnector = new GeminiConnector(config.googleApiKey, config.obsidianModel);
	const app = createWorkflowGraph(supervisorConnector, obsidianConnector, config);
	const telegramAdapter = new TelegramAdapter(app, config);

	await telegramAdapter.launch();
	console.log("Telegram adapter launched in long-polling mode.");
};

main().catch((error: unknown) => {
	console.error("Failed to start Phase 1 application:", error);
	process.exitCode = 1;
});