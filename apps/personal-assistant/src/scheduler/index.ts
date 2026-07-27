import "dotenv/config";

import { loadConfig } from "../config.js";
import { createSchedulerApp, launchScheduler, waitForProcessShutdown } from "./scheduler-app.js";

const main = async (): Promise<void> => {
  const config = loadConfig();

  if (!config.schedulerEnabled) {
    console.log("Scheduler disabled via ENABLE_SCHEDULER; idle until shutdown.");
    await waitForProcessShutdown();
    return;
  }

  const app = await createSchedulerApp(config);
  await launchScheduler(app);
};

main().catch((error: unknown) => {
  console.error("Failed to start scheduler:", error);
  process.exitCode = 1;
});
