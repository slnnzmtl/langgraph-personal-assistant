import path from "node:path";

import type { LoggingConfig, SchedulerPathsConfig } from "../config.js";
import {
  createCompositeLogger,
  createConsoleLogger,
  createFileLogger,
  setLogger,
  type Logger,
} from "@personal-assistant/supervisor-framework";

export type SetupAppLoggerOptions = {
  processName: string;
  config: LoggingConfig;
};

export const setupAppLogger = ({ processName, config }: SetupAppLoggerOptions): Logger => {
  const loggers: Logger[] = [createConsoleLogger(processName)];

  if (config.logToFile) {
    loggers.push(
      createFileLogger({
        logsDir: config.logsDir,
        fileName: `${processName}.log`,
      }),
    );
  }

  const logger = loggers.length === 1 ? loggers[0]! : createCompositeLogger(...loggers);
  setLogger(logger);
  return logger;
};

export const getSchedulerLockPath = (config: Pick<SchedulerPathsConfig, "runtimeAgentsFilePath">): string =>
  path.join(path.dirname(config.runtimeAgentsFilePath), ".scheduler-lock");
