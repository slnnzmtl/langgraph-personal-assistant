import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { getSkillsDir } from "../../../prompts/load-system-prompt.js";
import { readSkillContent } from "../../../prompts/skills-loader.js";
import { extractMessageTextContent } from "../../../utils/message-content.js";
import { resolveActiveSkillFromHistory } from "../../../tools/skill-scoped-registry.js";

export const ROUTINE_SKILL_NAME = "Routine";

const CRON_ROUTINE_JOB = "routine-note-creation";

const STRONG_TRIGGERS = [
  "routine",
  "todos",
  "todo",
  "daily note",
  "daily routine",
  "unchecked",
  "carry forward",
  "carry-over",
] as const;

const WEAK_TASK_TRIGGERS = ["task", "tasks"] as const;

const WEAK_CONTEXT_TRIGGERS = [
  "today",
  "yesterday",
  "daily",
  "routine",
  "move",
  "carry",
  "forward",
  "unchecked",
] as const;

const normalizeText = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/g, " ").trim();

const containsPhrase = (normalized: string, phrase: string): boolean =>
  normalized.includes(phrase);

const containsWord = (normalized: string, word: string): boolean =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized);

export const extractTriggerUserText = (messages: BaseMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof HumanMessage)) {
      continue;
    }

    const text = extractMessageTextContent(message.content).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
};

export const isRoutineCronTrigger = (text: string): boolean =>
  text.includes("SYSTEM_CRON_TRIGGER:")
  && text.includes(CRON_ROUTINE_JOB);

export const matchesRoutineIntent = (text: string): boolean => {
  const normalized = normalizeText(text);

  if (isRoutineCronTrigger(text)) {
    return true;
  }

  for (const trigger of STRONG_TRIGGERS) {
    if (trigger.includes(" ")) {
      if (containsPhrase(normalized, trigger)) {
        return true;
      }
    } else if (containsWord(normalized, trigger)) {
      return true;
    }
  }

  const hasTaskTrigger = WEAK_TASK_TRIGGERS.some((trigger) => containsWord(normalized, trigger));
  const hasContextTrigger = WEAK_CONTEXT_TRIGGERS.some((trigger) =>
    trigger.includes(" ")
      ? containsPhrase(normalized, trigger)
      : containsWord(normalized, trigger),
  );

  return hasTaskTrigger && hasContextTrigger;
};

export const formatAttachedSkillBlock = (skillName: string, content: string): string =>
  [
    `<attached_skill name="${skillName}">`,
    content.trim(),
    "</attached_skill>",
    "",
    `Follow the attached skill instructions exactly for this request. Do not call read_skill("${skillName}") unless the instructions are missing or stale.`,
  ].join("\n");

export type RoutineSkillAttachment = {
  skillName: string;
  content: string;
  block: string;
};

export const resolveRoutineSkillAttachment = (
  messages: BaseMessage[],
  skillsDir: string = getSkillsDir("obsidian", "xml"),
): RoutineSkillAttachment | undefined => {
  const activeSkill = resolveActiveSkillFromHistory(messages);
  if (activeSkill?.skillName === ROUTINE_SKILL_NAME.toLowerCase()) {
    return undefined;
  }

  const triggerText = extractTriggerUserText(messages);
  if (!triggerText || !matchesRoutineIntent(triggerText)) {
    return undefined;
  }

  const content = readSkillContent(skillsDir, ROUTINE_SKILL_NAME);

  return {
    skillName: ROUTINE_SKILL_NAME,
    content,
    block: formatAttachedSkillBlock(ROUTINE_SKILL_NAME, content),
  };
};

export const appendRoutineSkillAttachment = (
  basePrompt: string,
  messages: BaseMessage[],
  skillsDir?: string,
): string => {
  const attachment = resolveRoutineSkillAttachment(messages, skillsDir);
  if (!attachment) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${attachment.block}`;
};
