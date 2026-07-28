import path from "node:path";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export interface AppConfig {
  googleApiKey: string;
  supervisorModel: string;
  researcherModel: string;
  runtimeAgentsFilePath: string;
  cronJobsFilePath: string;
  messageHistoryMaxTokens: number;
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const getDefaultRuntimeAgentsPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "data/runtime-agents.json");

export const getDefaultCronJobsPath = (cwd = process.cwd()): string =>
  path.resolve(cwd, "data/cron-jobs.json");

export const loadConfig = (): AppConfig => {
  const defaultModel = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;

  return {
    googleApiKey: getRequiredEnv("GOOGLE_API_KEY"),
    supervisorModel: process.env.SUPERVISOR_MODEL ?? defaultModel,
    researcherModel: process.env.RESEARCHER_MODEL ?? defaultModel,
    runtimeAgentsFilePath: process.env.RUNTIME_AGENTS_FILE_PATH ?? getDefaultRuntimeAgentsPath(),
    cronJobsFilePath: process.env.CRON_JOBS_FILE_PATH ?? getDefaultCronJobsPath(),
    messageHistoryMaxTokens: 6000,
  };
};
