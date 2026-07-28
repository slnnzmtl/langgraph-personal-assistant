import "dotenv/config";

import { acquireProcessLock, getLogger, ProcessLockError } from "@personal-assistant/supervisor-framework";

import { loadConfig } from "../config.js";
import { getSchedulerLockPath, setupAppLogger } from "../logging/setup-logger.js";
import { createHealthServer, type HealthServer } from "../ops/health-server.js";
import { createSchedulerApp, launchScheduler, waitForProcessShutdown } from "./scheduler-app.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  setupAppLogger({ processName: "scheduler", config });
  const logger = getLogger();

  if (!config.schedulerEnabled) {
    logger.info("Scheduler disabled via ENABLE_SCHEDULER; idle until shutdown.");
    await waitForProcessShutdown();
    process.exit(0);
    return;
  }

  let ready = false;
  let healthServer: HealthServer | undefined;

  try {
    const processLock = await acquireProcessLock({
      lockFilePath: getSchedulerLockPath(config),
    });
    logger.info(`Acquired scheduler singleton lock at ${getSchedulerLockPath(config)}`);

    if (config.healthEnabled) {
      healthServer = await createHealthServer({
        port: config.healthPort,
        isReady: () => ready,
        logger,
      });
    }

    const app = await createSchedulerApp(config, { processLock });
    ready = true;
    await launchScheduler(app, {
      onShutdown: async () => {
        if (healthServer) {
          await healthServer.close();
        }
      },
    });
  } catch (error) {
    if (error instanceof ProcessLockError) {
      logger.error(error.message);
      process.exit(1);
      return;
    }

    throw error;
  }
};

main().catch((error: unknown) => {
  getLogger().error("Failed to start scheduler:", error);
  process.exitCode = 1;
});
