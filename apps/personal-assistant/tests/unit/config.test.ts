import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultCronJobsPath, getDefaultRuntimeAgentsPath, getDefaultVaultPath, loadConfig, normalizeMcpReconnectDelays } from "../../src/config.js";

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  ALLOWED_TELEGRAM_USER_ID: "42",
  GOOGLE_API_KEY: "test-key",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("uses the default vault path when OBSIDIAN_VAULT_PATH is unset", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("OBSIDIAN_VAULT_PATH", undefined);
    vi.stubEnv("APP_TIMEZONE", undefined);

    const config = loadConfig();

    expect(config.obsidianVaultPath).toBe(getDefaultVaultPath());
    expect(config.appTimezone).toBe("UTC");
  });

  it("prefers an explicit OBSIDIAN_VAULT_PATH", () => {
    const customPath = path.resolve("/tmp/personal-assistant-vault");

    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("OBSIDIAN_VAULT_PATH", customPath);

    const config = loadConfig();

    expect(config.obsidianVaultPath).toBe(customPath);
  });

  it("uses an explicit valid APP_TIMEZONE", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("APP_TIMEZONE", "America/New_York");

    const config = loadConfig();

    expect(config.appTimezone).toBe("America/New_York");
  });

  it("falls back to UTC when APP_TIMEZONE is invalid", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("APP_TIMEZONE", "Mars/Base");

    const config = loadConfig();

    expect(config.appTimezone).toBe("UTC");
  });

  it("uses the default geminiModel for both supervisor and obsidian when no overrides are set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("GEMINI_MODEL", undefined);
    vi.stubEnv("SUPERVISOR_MODEL", undefined);
    vi.stubEnv("OBSIDIAN_MODEL", undefined);

    const config = loadConfig();

    expect(config.geminiModel).toBe("gemini-2.5-flash-lite");
    expect(config.supervisorModel).toBe("gemini-2.5-flash-lite");
    expect(config.obsidianModel).toBe("gemini-2.5-flash-lite");
  });

  it("allows explicit SUPERVISOR_MODEL override", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash-lite");
    vi.stubEnv("SUPERVISOR_MODEL", "gemini-2.5-flash-lite");
    vi.stubEnv("OBSIDIAN_MODEL", undefined);

    const config = loadConfig();

    expect(config.supervisorModel).toBe("gemini-2.5-flash-lite");
    expect(config.obsidianModel).toBe("gemini-2.5-flash-lite");
  });

  it("allows explicit OBSIDIAN_MODEL override", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash-lite");
    vi.stubEnv("SUPERVISOR_MODEL", undefined);
    vi.stubEnv("OBSIDIAN_MODEL", "gemini-1.5-pro");

    const config = loadConfig();

    expect(config.supervisorModel).toBe("gemini-2.5-flash-lite");
    expect(config.obsidianModel).toBe("gemini-1.5-pro");
  });

  it("allows independent overrides for both supervisor and obsidian models", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("SUPERVISOR_MODEL", "gemini-2.5-flash-lite");
    vi.stubEnv("OBSIDIAN_MODEL", "gemini-1.5-pro");

    const config = loadConfig();

    expect(config.supervisorModel).toBe("gemini-2.5-flash-lite");
    expect(config.obsidianModel).toBe("gemini-1.5-pro");
  });

  it("keeps the in-process scheduler disabled by default", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("ENABLE_SCHEDULER", undefined);

    const config = loadConfig();

    expect(config.schedulerEnabled).toBe(false);
  });

  it("enables the in-process scheduler when ENABLE_SCHEDULER is truthy", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("ENABLE_SCHEDULER", "1");

    const config = loadConfig();

    expect(config.schedulerEnabled).toBe(true);
  });

  it("uses the default cron jobs file path when CRON_JOBS_FILE_PATH is unset", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("CRON_JOBS_FILE_PATH", undefined);

    const config = loadConfig();

    expect(config.cronJobsFilePath).toBe(getDefaultCronJobsPath());
  });

  it("prefers an explicit CRON_JOBS_FILE_PATH", () => {
    const customPath = path.resolve("/tmp/personal-assistant-cron-jobs.json");

    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("CRON_JOBS_FILE_PATH", customPath);

    const config = loadConfig();

    expect(config.cronJobsFilePath).toBe(customPath);
  });

  it("uses the default runtime agents file path when RUNTIME_AGENTS_FILE_PATH is unset", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("RUNTIME_AGENTS_FILE_PATH", undefined);

    const config = loadConfig();

    expect(config.runtimeAgentsFilePath).toBe(getDefaultRuntimeAgentsPath());
  });

  it("uses default MCP reconnect settings when env vars are unset", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("MCP_MAX_RECONNECT_ATTEMPTS", undefined);
    vi.stubEnv("MCP_RECONNECT_BASE_DELAY_MS", undefined);
    vi.stubEnv("MCP_RECONNECT_MAX_DELAY_MS", undefined);

    const config = loadConfig();

    expect(config.mcpMaxReconnectAttempts).toBe(1);
    expect(config.mcpReconnectBaseDelayMs).toBe(0);
    expect(config.mcpReconnectMaxDelayMs).toBe(5000);
  });

  it("parses MCP reconnect env vars when set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("MCP_MAX_RECONNECT_ATTEMPTS", "3");
    vi.stubEnv("MCP_RECONNECT_BASE_DELAY_MS", "500");
    vi.stubEnv("MCP_RECONNECT_MAX_DELAY_MS", "8000");

    const config = loadConfig();

    expect(config.mcpMaxReconnectAttempts).toBe(3);
    expect(config.mcpReconnectBaseDelayMs).toBe(500);
    expect(config.mcpReconnectMaxDelayMs).toBe(8000);
  });

  it("raises max delay to at least base delay when max is lower", () => {
    expect(normalizeMcpReconnectDelays(500, 250)).toEqual({
      baseDelayMs: 500,
      maxDelayMs: 500,
    });
  });

  it("uses default health and logging settings", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("HEALTH_PORT", undefined);
    vi.stubEnv("HEALTH_ENABLED", undefined);
    vi.stubEnv("LOG_DIR", undefined);
    vi.stubEnv("LOG_TO_FILE", undefined);
    vi.stubEnv("NODE_ENV", undefined);

    const config = loadConfig();

    expect(config.healthPort).toBe(8080);
    expect(config.healthEnabled).toBe(true);
    expect(config.logsDir.endsWith(`${path.sep}logs`)).toBe(true);
    expect(config.logToFile).toBe(false);
  });

  it("parses health and logging env overrides", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("HEALTH_PORT", "9090");
    vi.stubEnv("HEALTH_ENABLED", "0");
    vi.stubEnv("LOG_DIR", "/tmp/personal-assistant-logs");
    vi.stubEnv("LOG_TO_FILE", "1");

    const config = loadConfig();

    expect(config.healthPort).toBe(9090);
    expect(config.healthEnabled).toBe(false);
    expect(config.logsDir).toBe("/tmp/personal-assistant-logs");
    expect(config.logToFile).toBe(true);
  });

  it("defaults allowedTelegramChatId to allowedTelegramUserId", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("ALLOWED_TELEGRAM_CHAT_ID", undefined);

    const loaded = loadConfig();

    expect(loaded.allowedTelegramChatId).toBe(REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
  });
});