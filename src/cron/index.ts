import "dotenv/config";

import { loadConfig } from "../config.js";
import { createSchedulerApp, launchScheduler } from "./scheduler-app.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const app = await createSchedulerApp(config);
  await launchScheduler(app);
};

main().catch((error: unknown) => {
  console.error("Failed to start cron scheduler:", error);
  process.exitCode = 1;
});
