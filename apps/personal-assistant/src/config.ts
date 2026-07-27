import path from "node:path";

import { getMessageHistoryMaxTokens } from "@personal-assistant/supervisor-framework";

const DEFAULT_APP_TIMEZONE = "UTC";
const DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS = 1;
const DEFAULT_MCP_RECONNECT_BASE_DELAY_MS = 0;
const DEFAULT_MCP_RECONNECT_MAX_DELAY_MS = 5_000;

const REQUIRED_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "ALLOWED_TELEGRAM_USER_ID",
  "GOOGLE_API_KEY",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramUserId: string;
  googleApiKey: string;
  geminiModel: string;
  supervisorModel: string;
  obsidianModel: string;
  financeModel: string;
  configurationModel: string;
  obsidianVaultPath: string;
  appTimezone: string;
  schedulerEnabled: boolean;
  cronJobsFilePath: string;
  runtimeAgentsFilePath: string;
  messageHistoryMaxTokens: number;
  mcpMaxReconnectAttempts: number;
  mcpReconnectBaseDelayMs: number;
  mcpReconnectMaxDelayMs: number;
  // Optional: Official hosted Supabase MCP server
  supabaseMcpUrl?: string | undefined;
  supabaseProjectRef?: string | undefined;
  supabaseAccessToken?: string | undefined;
}

export const getDefaultVaultPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "src/obsidian-vault");

export const getDefaultCronJobsPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "data/cron-jobs.json");

export const getDefaultRuntimeAgentsPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "data/runtime-agents.json");

const isTruthyEnv = (value: string | undefined): boolean =>
  value !== undefined && value !== "false" && value !== "0";

const getRequiredEnv = (name: RequiredEnvVar): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const parseNonNegativeInt = (raw: string | undefined, defaultValue: number): number => {
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
};

export const normalizeMcpReconnectDelays = (
  baseDelayMs: number,
  maxDelayMs: number,
): { baseDelayMs: number; maxDelayMs: number } => ({
  baseDelayMs,
  maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
});

export const normalizeAppTimezone = (value: string | undefined): string => {
  const candidate = value?.trim();

  if (!candidate) {
    return DEFAULT_APP_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_APP_TIMEZONE;
  }
};

export const loadConfig = (): AppConfig => {
  const defaultGeminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
  const mcpReconnectBaseDelayMs = parseNonNegativeInt(
    process.env.MCP_RECONNECT_BASE_DELAY_MS,
    DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
  );
  const mcpReconnectMaxDelayMs = parseNonNegativeInt(
    process.env.MCP_RECONNECT_MAX_DELAY_MS,
    DEFAULT_MCP_RECONNECT_MAX_DELAY_MS,
  );
  const normalizedMcpReconnectDelays = normalizeMcpReconnectDelays(
    mcpReconnectBaseDelayMs,
    mcpReconnectMaxDelayMs,
  );

  return {
    telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    allowedTelegramUserId: getRequiredEnv("ALLOWED_TELEGRAM_USER_ID"),
    googleApiKey: getRequiredEnv("GOOGLE_API_KEY"),
    geminiModel: defaultGeminiModel,
    supervisorModel: process.env.SUPERVISOR_MODEL ?? defaultGeminiModel,
    obsidianModel: process.env.OBSIDIAN_MODEL ?? defaultGeminiModel,
    financeModel: process.env.FINANCE_MODEL ?? defaultGeminiModel,
    configurationModel: process.env.CONFIGURATION_MODEL ?? process.env.OBSIDIAN_MODEL ?? defaultGeminiModel,
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH ?? getDefaultVaultPath(),
    appTimezone: normalizeAppTimezone(process.env.APP_TIMEZONE),
    schedulerEnabled: isTruthyEnv(process.env.ENABLE_SCHEDULER),
    cronJobsFilePath: process.env.CRON_JOBS_FILE_PATH ?? getDefaultCronJobsPath(),
    runtimeAgentsFilePath: process.env.RUNTIME_AGENTS_FILE_PATH ?? getDefaultRuntimeAgentsPath(),
    messageHistoryMaxTokens: getMessageHistoryMaxTokens(),
    mcpMaxReconnectAttempts: parseNonNegativeInt(
      process.env.MCP_MAX_RECONNECT_ATTEMPTS,
      DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS,
    ),
    mcpReconnectBaseDelayMs: normalizedMcpReconnectDelays.baseDelayMs,
    mcpReconnectMaxDelayMs: normalizedMcpReconnectDelays.maxDelayMs,
    supabaseMcpUrl: process.env.SUPABASE_MCP_URL ?? "https://mcp.supabase.com/mcp",
    supabaseProjectRef: process.env.SUPABASE_PROJECT_REF,
    supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN,
  };
};
