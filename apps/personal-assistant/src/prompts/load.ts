import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatCurrentTime, toUtcDayRange } from "../utils/datetime.js";
import { PROMPTS_DATA_ROOT } from "./prompt-store.js";

export { PROMPTS_DATA_ROOT } from "./prompt-store.js";

const shiftDateByDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

export const formatSystemMetadata = (
  date: Date = new Date(),
  options?: { runtimeAgent?: string },
): string => {
  const currentDatetime = formatCurrentTime(date);
  const today = toUtcDayRange(date);
  const yesterday = toUtcDayRange(shiftDateByDays(date, -1));
  const lines = [
    "<system_metadata>",
    `CURRENT DATETIME: ${currentDatetime}`,
    `TODAY    → since: ${today.since}, until: ${today.until}`,
    `YESTERDAY → since: ${yesterday.since}, until: ${yesterday.until}`,
  ];

  if (options?.runtimeAgent) {
    lines.push(`RUNTIME_AGENT: ${options.runtimeAgent}`);
  }

  lines.push("</system_metadata>");
  return lines.join("\n");
};

export const appendDynamicSections = (
  staticPrompt: string,
  ...sections: string[]
): string => {
  const dynamic = sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");

  if (dynamic.length === 0) {
    return staticPrompt.trim();
  }

  return `${staticPrompt.trim()}\n\n${dynamic}`;
};

export const appendSystemMetadata = (
  content: string,
  date: Date = new Date(),
  options?: { runtimeAgent?: string },
): string => appendDynamicSections(content, formatSystemMetadata(date, options));

const resolvePromptPath = (key: string, fileType: "md" | "xml" = "md"): string => {
  if (path.isAbsolute(key) && existsSync(key)) {
    return key;
  }

  const base = path.join(PROMPTS_DATA_ROOT, key);
  const candidates = [
    `${base}.${fileType}`,
    ...(fileType === "md" ? [`${base}.xml`] : [`${base}.md`]),
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

const readPromptFile = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();
  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }
  return content;
};

/** Load raw agent prompt content by key from `data/prompts/{key}.{md|xml}`. */
export const loadPrompt = (key: string, fileType: "md" | "xml" = "md"): string => {
  const filePath = resolvePromptPath(key, fileType);
  return readPromptFile(filePath);
};

export const SUPERVISOR_PROMPT_KEY = "supervisor" as const;

/** Static supervisor instructions only (safe to put in a Gemini context cache). */
export const loadSupervisorSystemPrompt = (): string =>
  loadPrompt(SUPERVISOR_PROMPT_KEY, "xml");

/** Per-turn datetime ranges for the supervisor (must stay outside the cache). */
export const loadSupervisorDynamicContext = (): string =>
  formatSystemMetadata(new Date());

export const loadSystemPromptByKey = (key: string): string => loadPrompt(key, "xml");

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
