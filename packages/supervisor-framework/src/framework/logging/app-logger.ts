import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

const formatArgs = (args: unknown[]): string =>
  args.length > 0 ? ` ${args.map((value) => String(value)).join(" ")}` : "";

const writeLogLine = (
  level: string,
  message: string,
  args: unknown[],
  prefix?: string,
): string => {
  const tag = prefix ? `[${prefix}] ` : "";
  return `${new Date().toISOString()} ${level.toUpperCase()} ${tag}${message}${formatArgs(args)}\n`;
};

export const createConsoleLogger = (prefix?: string): Logger => ({
  debug(message, ...args) {
    console.debug(writeLogLine("debug", message, args, prefix).trimEnd());
  },
  info(message, ...args) {
    console.info(writeLogLine("info", message, args, prefix).trimEnd());
  },
  warn(message, ...args) {
    console.warn(writeLogLine("warn", message, args, prefix).trimEnd());
  },
  error(message, ...args) {
    console.error(writeLogLine("error", message, args, prefix).trimEnd());
  },
});

export type FileLoggerOptions = {
  logsDir: string;
  fileName?: string;
};

export const createFileLogger = (options: FileLoggerOptions): Logger => {
  const filePath = path.join(options.logsDir, options.fileName ?? "app.log");
  let ready = mkdir(options.logsDir, { recursive: true }).then(() => undefined);

  const append = async (line: string): Promise<void> => {
    await ready;
    await appendFile(filePath, line, "utf8");
  };

  const log =
    (level: string) =>
    (message: string, ...args: unknown[]): void => {
      void append(writeLogLine(level, message, args)).catch((error: unknown) => {
        console.error("Failed to write log file:", error);
      });
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
};

export const createCompositeLogger = (...loggers: Logger[]): Logger => ({
  debug(message, ...args) {
    for (const logger of loggers) {
      logger.debug(message, ...args);
    }
  },
  info(message, ...args) {
    for (const logger of loggers) {
      logger.info(message, ...args);
    }
  },
  warn(message, ...args) {
    for (const logger of loggers) {
      logger.warn(message, ...args);
    }
  },
  error(message, ...args) {
    for (const logger of loggers) {
      logger.error(message, ...args);
    }
  },
});

let defaultLogger: Logger = createConsoleLogger();

export const getLogger = (): Logger => defaultLogger;

export const setLogger = (logger: Logger): void => {
  defaultLogger = logger;
};
