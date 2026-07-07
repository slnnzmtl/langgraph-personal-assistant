import path from "node:path";

const DEFAULT_APP_TIMEZONE = "UTC";

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
  obsidianVaultPath: string;
  appTimezone: string;
  // Optional: Supabase finance integration
  supabaseUrl?: string | undefined;
  supabaseServiceRoleKey?: string | undefined;
  enableFinanceSync?: boolean | undefined;
}

export const getDefaultVaultPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "src/obsidian-vault");

const getRequiredEnv = (name: RequiredEnvVar): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const normalizeAppTimezone = (value: string | undefined): string => {
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
  
  return {
    telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    allowedTelegramUserId: getRequiredEnv("ALLOWED_TELEGRAM_USER_ID"),
    googleApiKey: getRequiredEnv("GOOGLE_API_KEY"),
    geminiModel: defaultGeminiModel,
    supervisorModel: process.env.SUPERVISOR_MODEL ?? defaultGeminiModel,
    obsidianModel: process.env.OBSIDIAN_MODEL ?? defaultGeminiModel,
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH ?? getDefaultVaultPath(),
    appTimezone: normalizeAppTimezone(process.env.APP_TIMEZONE),
    // Optional Supabase finance integration
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    enableFinanceSync: process.env.ENABLE_FINANCE_SYNC === "true",
  };
};