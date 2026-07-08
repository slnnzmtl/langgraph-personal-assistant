import { readFileSync } from "node:fs";
import path from "node:path";
import { formatCurrentTime, getZonedDateDetails } from "../utils/datetime.js";

export const PROMPTS_ROOT = path.resolve(process.cwd(), "prompts");

export const SUPERVISOR_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "supervisor.md");
export const OBSIDIAN_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "obsidian.md");
export const FINANCE_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "finance.md");
export const CONFIGURATOR_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "configurator.md");

const injectCurrentDatetime = (content: string): string => {
  const currentDatetime = formatCurrentTime(new Date());
  return `${content}\nCurrent datetime: ${currentDatetime}`;
}

const formatRoutineFilePath = (date: Date): string => {
  const { monthName, dayNumber, weekday } = getZonedDateDetails(date);
  return `routine/${monthName}/${monthName} ${Number(dayNumber)} - ${weekday}.md`;
};

const injectObsidianRoutineHint = (prompt: string) => (date: Date = new Date()): string => {
  return `${prompt}\nRoutine files live under routine/[Month]/[Month] [Day] - [Weekday].md. For today, use ${formatRoutineFilePath(date)}.`;
};

export const loadSystemPromptMarkdown = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();

  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }

  return content;
};

export const loadSupervisorSystemPrompt = (): string =>
  injectCurrentDatetime(loadSystemPromptMarkdown(SUPERVISOR_SYSTEM_PROMPT_PATH));


export const loadObsidianSystemPrompt = (): string =>
  injectObsidianRoutineHint(injectCurrentDatetime(loadSystemPromptMarkdown(OBSIDIAN_SYSTEM_PROMPT_PATH)))();

export const loadFinanceSystemPrompt = (): string =>
  injectCurrentDatetime(loadSystemPromptMarkdown(FINANCE_SYSTEM_PROMPT_PATH));

export const loadConfiguratorSystemPrompt = (): string =>
  injectCurrentDatetime(loadSystemPromptMarkdown(CONFIGURATOR_SYSTEM_PROMPT_PATH));

export const shouldHotReloadPrompts = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.ENABLE_PROMPT_HOT_RELOAD !== "false";

export const createPromptLoader = (
  filePath: string,
  options?: {
    hotReload?: boolean;
    timezone?: string;
  },
): (() => string) => {
  let cachedPrompt: string | undefined;

  return (): string => {
    if (options?.hotReload) {
      return loadSystemPromptMarkdown(filePath);
    }

    cachedPrompt ??= loadSystemPromptMarkdown(filePath);
    return cachedPrompt;
  };
};