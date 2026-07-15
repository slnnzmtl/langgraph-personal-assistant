import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatCurrentTime, getZonedDateDetails } from "../utils/datetime.js";
import { formatSkillsForPrompt, listSkills } from "./skills-loader.js";

export const PROMPTS_ROOT = path.resolve(process.cwd(), "prompts");
export const SKILLS_ROOT = path.resolve(process.cwd(), "skills");

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

const injectObsidianRoutineHint = (prompt: string, date: Date = new Date()): string => {
  const yesterdayPath = formatRoutineFilePath(shiftDateByDays(date, -1));
  const todayPath = formatRoutineFilePath(date);
  const routineHint = [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `Yesterday: ${yesterdayPath}`,
    `Today: ${todayPath}`,
  ].join("\n");

  return `${prompt}\n\n${routineHint}`;
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

const promptKeyRoot = (key: string): string => key.split("/")[0] ?? key;

const resolveSkillPromptPath = (key: string): string | undefined => {
  const match = key.match(/^([^/]+)\/skills\/([^/]+)$/);
  if (!match) {
    return undefined;
  }

  const [, agent, skillName] = match;
  if (!agent || !skillName) {
    return undefined;
  }
  const filePath = path.join(SKILLS_ROOT, agent, `${skillName}.md`);
  return existsSync(filePath) ? filePath : undefined;
};

const resolvePromptPath = (key: string, fileType: "md" | "xml" = "md"): string => {
  if (path.isAbsolute(key) && existsSync(key)) {
    return key;
  }

  const skillPromptPath = resolveSkillPromptPath(key);
  if (skillPromptPath) {
    return skillPromptPath;
  }

  const candidates = [
    path.join(PROMPTS_ROOT, `${key}.${fileType}`),
    ...(fileType === "md" ? [path.join(PROMPTS_ROOT, `${key}.xml`)] : []),
    ...(fileType === "xml" ? [path.join(PROMPTS_ROOT, `${key}.md`)] : []),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Prompt not found: "${key}" (${fileType}). Tried:\n${candidates.map((candidate) => `  - ${candidate}`).join("\n")}`,
  );
};

const resolveSkillsDir = (key: string): string => path.join(SKILLS_ROOT, promptKeyRoot(key));

const readPromptFile = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();
  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }
  return content;
};

/**
 * Get the skills directory path for a given prompt key.
 * Returns path to `skills/{key}` (e.g. skills/finance).
 * @param key - Prompt key (e.g. "finance", "obsidian")
 * @param fileType - File type: "md" or "xml" (default: "md")
 * @returns Path to the skills directory
 */
export const getSkillsDir = (key: string, fileType: "md" | "xml" = "md"): string => {
  resolvePromptPath(key, fileType);
  return resolveSkillsDir(key);
};

/**
 * Load raw prompt content by key.
 * Resolves `prompts/{key}.{md|xml}` and skill files at `skills/{agent}/{skill}.md`
 * via the legacy `{agent}/skills/{skill}` key shape.
 * @param key - Prompt key (e.g. "supervisor", "obsidian", "finance/skills/sync-expenses")
 * @param fileType - File type: "md" or "xml" (default: "md")
 * @returns Raw prompt content
 */
export const loadPrompt = (key: string, fileType: "md" | "xml" = "md"): string => {
  const filePath = resolvePromptPath(key, fileType);
  const content = readPromptFile(filePath);
  const skillsDir = resolveSkillsDir(key);
  return injectSkills(content, skillsDir);
};

const loadDatedPrompt = (key: string, fileType: "md" | "xml" = "md"): string =>
  injectCurrentDatetime(loadPrompt(key, fileType));

export const loadSupervisorSystemPrompt = (): string => loadDatedPrompt("supervisor", "xml");

export const loadObsidianSystemPrompt = (): string =>
  injectObsidianRoutineHint(loadDatedPrompt("obsidian", "xml"));

export const loadFinanceSystemPrompt = (): string => loadDatedPrompt("finance", "xml");

export const loadConfigurationSystemPrompt = (): string => loadDatedPrompt("configuration");

export const createPromptLoader = (
  key: string,
  options?: {
    hotReload?: boolean;
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
