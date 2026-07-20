import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatCurrentTime, getZonedDateDetails, toUtcDayRange } from "../utils/datetime.js";
import {
  SKILLS_ROOT,
  formatSkillsForPrompt,
  listSkills,
  readSkillContent,
} from "./skills-loader.js";

export { SKILLS_ROOT };

export const PROMPTS_ROOT = path.resolve(process.cwd(), "prompts");

const formatRoutineFilePath = (date: Date): string => {
  const { monthName, dayNumber, weekday } = getZonedDateDetails(date);
  return `routine/${monthName}/${monthName} ${Number(dayNumber)} - ${weekday}.md`;
};

const shiftDateByDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

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

export const formatObsidianRoutineHint = (date: Date = new Date()): string => {
  const yesterdayPath = formatRoutineFilePath(shiftDateByDays(date, -1));
  const todayPath = formatRoutineFilePath(date);

  return [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `Yesterday: ${yesterdayPath}`,
    `Today: ${todayPath}`,
  ].join("\n");
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

const injectSkills = (prompt: string, module: string): string => {
  const skills = listSkills({ module });
  const skillsBlock = formatSkillsForPrompt(skills);

  if (skillsBlock.length === 0) {
    return prompt;
  }

  const skillsHint = "Call read_skill(skill_name) to load a skill's full step-by-step instructions before performing it.";
  return `${prompt}\n\n${skillsBlock}\n\n${skillsHint}`;
};

const promptKeyRoot = (key: string): string => key.split("/")[0] ?? key;

const SKILLS_MODULE_PROMPTS = new Set(["finance", "obsidian", "configuration"]);

const resolveSkillsModule = (key: string): string | undefined => {
  if (path.isAbsolute(key)) {
    return undefined;
  }

  const root = promptKeyRoot(key);
  return SKILLS_MODULE_PROMPTS.has(root) ? root : undefined;
};

const resolveSkillPromptPath = (key: string): string | undefined => {
  const flatMatch = key.match(/^skills\/([^/]+)$/);
  if (flatMatch?.[1]) {
    const skillName = flatMatch[1];
    const candidates = [
      path.join(SKILLS_ROOT, `${skillName}.xml`),
      path.join(SKILLS_ROOT, `${skillName}.md`),
    ];

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }

  return undefined;
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

const readPromptFile = (filePath: string): string => {
  const content = readFileSync(filePath, "utf8").trim();
  if (content.length === 0) {
    throw new Error(`System prompt file is empty: ${filePath}`);
  }
  return content;
};

export const getSkillsRoot = (): string => SKILLS_ROOT;

export const listSkillsForModule = (module: string) => listSkills({ module });

/**
 * Load raw prompt content by key.
 * Resolves `prompts/{key}.{md|xml}` and flat skill files at `skills/{skillName}.{md|xml}`
 * via the `skills/{skillName}` key shape.
 */
export const loadPrompt = (key: string, fileType: "md" | "xml" = "md"): string => {
  const filePath = resolvePromptPath(key, fileType);
  const content = readPromptFile(filePath);

  const skillPromptPath = resolveSkillPromptPath(key);
  if (skillPromptPath) {
    const skillName = key.match(/^skills\/([^/]+)$/)?.[1];
    if (skillName) {
      return readSkillContent(skillName);
    }
  }

  const skillsModule = resolveSkillsModule(key);
  if (skillsModule) {
    return injectSkills(content, skillsModule);
  }

  return content;
};

export const RUNTIME_EXECUTION_MODEL = `<runtime_execution>
- You run in an automatic tool loop: after tool results, you are invoked again until you reply with plain text or stop calling tools.
- Tool schemas define only tool arguments. Never emit extra control flags or parameters not in a tool schema.
- Parallel tool calls are supported when operations are independent. Sequence calls only when one depends on another's result (e.g., read before overwrite write).
- Prior tool results are already in message history as tool messages — use them directly; do not restate or manually track step state.
- Never return an empty turn (no text and no tool calls).
</runtime_execution>`;

export const injectRuntimeExecutionModel = (prompt: string): string =>
  `${prompt}\n\n${RUNTIME_EXECUTION_MODEL}`;

export const loadSystemPromptByKey = (key: string): string => {
  let prompt = loadPrompt(key, "xml");
  if (SKILLS_MODULE_PROMPTS.has(key)) {
    prompt = injectRuntimeExecutionModel(prompt);
  }
  return prompt;
};

export const loadSupervisorSystemPrompt = (): string =>
  appendSystemMetadata(loadPrompt("supervisor", "xml"));

export const loadObsidianSystemPrompt = (): string => loadSystemPromptByKey("obsidian");

export const loadFinanceSystemPrompt = (): string => loadSystemPromptByKey("finance");

export const loadConfigurationSystemPrompt = (): string => loadSystemPromptByKey("configuration");

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
