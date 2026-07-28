import "dotenv/config";

import { createApp, launchApp } from "./app.js";
import { loadConfig } from "./config.js";

const main = async (): Promise<void> => {
  const app = await createApp(loadConfig());

  const shutdown = async (): Promise<void> => {
    await app.shutdown();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await launchApp(app);
};

main().catch((error: unknown) => {
  console.error("Failed to start personal assistant:", error);
  process.exitCode = 1;
});
