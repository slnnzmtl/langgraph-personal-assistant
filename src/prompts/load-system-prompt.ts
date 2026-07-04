import { readFileSync } from "node:fs";
import path from "node:path";

export const PROMPTS_ROOT = path.resolve(process.cwd(), "prompts");

export const SUPERVISOR_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "supervisor.md");
export const OBSIDIAN_SYSTEM_PROMPT_PATH = path.join(PROMPTS_ROOT, "obsidian.md");

export const loadSystemPromptMarkdown = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();

  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }

  return content;
};

export const loadSupervisorSystemPrompt = (): string =>
  loadSystemPromptMarkdown(SUPERVISOR_SYSTEM_PROMPT_PATH);

export const loadObsidianSystemPrompt = (): string =>
  loadSystemPromptMarkdown(OBSIDIAN_SYSTEM_PROMPT_PATH);

export const shouldHotReloadPrompts = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.ENABLE_PROMPT_HOT_RELOAD !== "false";

export const createPromptLoader = (
  filePath: string,
  options?: {
    hotReload?: boolean;
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