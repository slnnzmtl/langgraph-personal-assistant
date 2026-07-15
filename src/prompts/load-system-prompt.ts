import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatCurrentTime, getZonedDateDetails } from "../utils/datetime.js";
import { formatSkillsForPrompt, listSkills } from "./skills-loader.js";

export const PROMPTS_ROOT = path.resolve(process.cwd(), "prompts");

const toUtcDayRange = (date: Date, timeZone: string = process.env.APP_TIMEZONE ?? "UTC") => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date, timeZone);
  return {
    since: `${year}-${monthNumber}-${dayNumber}T00:00:00Z`,
    until: `${year}-${monthNumber}-${dayNumber}T23:59:59Z`,
  };
};

const injectCurrentDatetime = (content: string): string => {
  const now = new Date();
  const currentDatetime = formatCurrentTime(now);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const today = toUtcDayRange(now);
  const yesterday = toUtcDayRange(yesterdayDate);
  const header = [
    `<system_metadata>`,
    `⏰ CURRENT DATETIME: ${currentDatetime}`,
    `📅 TODAY    → since: ${today.since}, until: ${today.until}`,
    `📅 YESTERDAY → since: ${yesterday.since}, until: ${yesterday.until}`,
    "</system_metadata>",
  ].join("\n");
  return `${header}\n\n${content}`;
};

const formatRoutineFilePath = (date: Date): string => {
  const { monthName, dayNumber, weekday } = getZonedDateDetails(date);
  return `routine/${monthName}/${monthName} ${Number(dayNumber)} - ${weekday}.md`;
};

const shiftDateByDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const injectObsidianRoutineHint = (prompt: string) => (date: Date = new Date()): string => {
  const yesterdayPath = formatRoutineFilePath(shiftDateByDays(date, -1));
  const todayPath = formatRoutineFilePath(date);

  return `${prompt}\nYesterday: ${yesterdayPath}\nToday: ${todayPath}`;
};

const injectSkills = (prompt: string, skillsDir: string): string => {
  const skills = listSkills(skillsDir);
  const skillsBlock = formatSkillsForPrompt(skills);

  if (skillsBlock.length === 0) {
    return prompt;
  }

  const skillsHint = "Call read_skill(skill_name) to load a skill's full step-by-step instructions before performing it.";
  return `${prompt}\n\n${skillsBlock}\n\n${skillsHint}`;
};


const resolvePromptPath = (key: string, fileType: "md" | "xml" = "md"): string => {
  if (path.isAbsolute(key) && existsSync(key)) {
    return key;
  }

  const filePath = path.join(PROMPTS_ROOT, `${key}.${fileType}`);
  if (existsSync(filePath)) {
    return filePath;
  }

  const dirFilePath = path.join(PROMPTS_ROOT, key, `system.${fileType}`);
  if (existsSync(dirFilePath)) {
    return dirFilePath;
  }

  throw new Error(
    `Prompt not found: "${key}" (${fileType}). Tried:\n  - ${filePath}\n  - ${dirFilePath}`
  );
};

const readPromptFile = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();
  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }
  return content;
};

/**
 * Get the skills directory path for a given prompt key.
 * Returns path to `${promptDir}/skills` if it exists, otherwise returns path even if it doesn't exist.
 * @param key - Prompt key (e.g. "finance", "obsidian")
 * @param fileType - File type: "md" or "xml" (default: "md")
 * @returns Path to the skills directory
 */
export const getSkillsDir = (key: string, fileType: "md" | "xml" = "md"): string => {
  const filePath = resolvePromptPath(key, fileType);
  return path.join(path.dirname(filePath), "skills");
};

/**
 * Load raw prompt content by key.
 * Automatically resolves file paths: tries `${key}.${fileType}` first, then `${key}/system.${fileType}`.
 * @param key - Prompt key (e.g. "supervisor", "obsidian", "finance/skills/sync-expenses")
 * @param fileType - File type: "md" or "xml" (default: "md")
 * @returns Raw prompt content
 */
export const loadPrompt = (key: string, fileType: "md" | "xml" = "md"): string => {
  const filePath = resolvePromptPath(key, fileType);
  const content = readPromptFile(filePath);
  const skillsDir = path.join(path.dirname(filePath), "skills");
  return injectSkills(content, skillsDir);
};

export const loadSupervisorSystemPrompt = (): string =>
  injectCurrentDatetime(loadPrompt("supervisor"));

export const loadObsidianSystemPrompt = (): string =>
  injectObsidianRoutineHint(injectCurrentDatetime(loadPrompt("obsidian", "xml")))();

export const loadFinanceSystemPrompt = (): string =>
  injectCurrentDatetime(loadPrompt("finance"));

export const loadConfiguratorSystemPrompt = (): string =>
  injectCurrentDatetime(loadPrompt("configurator"));

export const shouldHotReloadPrompts = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.ENABLE_PROMPT_HOT_RELOAD !== "false";

export const createPromptLoader = (
  key: string,
  options?: {
    hotReload?: boolean;
    timezone?: string;
    fileType?: "md" | "xml";
  },
): (() => string) => {
  let cachedPrompt: string | undefined;

  return (): string => {
    if (options?.hotReload) {
      return loadPrompt(key, options.fileType ?? "md");
    }

    cachedPrompt ??= loadPrompt(key, options?.fileType ?? "md");
    return cachedPrompt;
  };
};