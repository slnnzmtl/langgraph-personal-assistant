import "dotenv/config";

import { createApp, launchApp } from "./app.js";
import { loadConfig } from "./config.js";

const main = async (): Promise<void> => {
  const app = await createApp(loadConfig());
  await launchApp(app);
};

main().catch((error: unknown) => {
  console.error("Failed to start Phase 1 application:", error);
  process.exitCode = 1;
});
