import "dotenv/config";

import { createApp, launchApp } from "./app.js";
import { loadConfig } from "./config.js";
import { setupAppLogger } from "./logging/setup-logger.js";
import { createHealthServer, type HealthServer } from "./ops/health-server.js";
import { getLogger } from "@personal-assistant/supervisor-framework";

const main = async (): Promise<void> => {
  const config = loadConfig();
  setupAppLogger({ processName: "bot", config });

  let ready = false;
  let healthServer: HealthServer | undefined;

  if (config.healthEnabled) {
    healthServer = await createHealthServer({
      port: config.healthPort,
      isReady: () => ready,
      logger: getLogger(),
    });
  }

  const app = await createApp(config);
  ready = true;

  const shutdown = async (): Promise<void> => {
    await app.shutdown();
    if (healthServer) {
      await healthServer.close();
    }
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  try {
    await launchApp(app);
  } catch (error) {
    if (healthServer) {
      await healthServer.close();
    }
    throw error;
  }
};

main().catch(async (error: unknown) => {
  getLogger().error("Failed to start personal assistant:", error);
  process.exitCode = 1;
});
