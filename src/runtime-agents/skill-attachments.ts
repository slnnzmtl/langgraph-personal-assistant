import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { getSkillsDir } from "../prompts/load-system-prompt.js";
import { readSkillContent } from "../prompts/skills-loader.js";
import { extractMessageTextContent } from "../utils/message-content.js";
import type { RuntimeAgentDefinition, SkillAttachmentRule } from "../core/types/agent.js";

const normalizeText = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/g, " ").trim();

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsPhrase = (normalized: string, phrase: string): boolean =>
  normalized.includes(normalizeText(phrase));

const containsWord = (normalized: string, word: string): boolean => {
  const normalizedWord = normalizeText(word);

  if (normalizedWord === "task") {
    return /\btasks?\b/.test(normalized);
  }

  return new RegExp(`\\b${escapeRegex(normalizedWord)}\\b`).test(normalized);
};

const matchesPhrase = (normalized: string, phrase: string): boolean => {
  const normalizedPhrase = normalizeText(phrase);
  return normalizedPhrase.includes(" ")
    ? containsPhrase(normalized, normalizedPhrase)
    : containsWord(normalized, normalizedPhrase);
};

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

export const matchesCronJobTrigger = (text: string, cronJobName: string): boolean =>
  text.includes("SYSTEM_CRON_TRIGGER:")
  && text.includes(cronJobName);

export const matchesSkillAttachmentRule = (
  text: string,
  rule: SkillAttachmentRule,
): boolean => {
  if (rule.cronJobName && matchesCronJobTrigger(text, rule.cronJobName)) {
    return true;
  }

  const match = rule.match;
  if (!match) {
    return false;
  }

  const normalized = normalizeText(text);
  const anyPhrases = match.anyPhrases ?? [];
  const allPhrases = match.allPhrases ?? [];

  if (anyPhrases.length === 0 && allPhrases.length === 0) {
    return false;
  }

  const anyMatches = anyPhrases.length === 0
    || anyPhrases.some((phrase) => matchesPhrase(normalized, phrase));
  const allMatch = allPhrases.length === 0
    || allPhrases.every((phrase) => matchesPhrase(normalized, phrase));

  return anyMatches && allMatch;
};

export const formatAttachedSkillBlock = (skillName: string, content: string): string =>
  [
    `<attached_skill name="${skillName}">`,
    content.trim(),
    "</attached_skill>",
  ].join("\n");

export const formatAttachedSkillsPrompt = (
  attachments: Array<{ skillName: string; content: string }>,
): string => {
  if (attachments.length === 0) {
    return "";
  }

  const blocks = attachments.map((attachment) =>
    formatAttachedSkillBlock(attachment.skillName, attachment.content),
  );

  const skillNames = attachments.map((attachment) => `"${attachment.skillName}"`).join(", ");

  return [
    "<attached_skills>",
    blocks.join("\n\n"),
    "</attached_skills>",
    "",
    `Follow the attached skill instructions exactly for this request. Do not call read_skill for ${skillNames} unless the instructions are missing or stale.`,
  ].join("\n");
};

export type ResolvedSkillAttachment = {
  owner: string;
  skillName: string;
  content: string;
};

const attachmentKey = (owner: string, skillName: string): string =>
  `${owner.toLowerCase()}:${skillName.toLowerCase()}`;

export const resolveSkillAttachments = (
  rules: SkillAttachmentRule[],
  messages: BaseMessage[],
): ResolvedSkillAttachment[] => {
  const triggerText = extractTriggerUserText(messages);
  if (!triggerText) {
    return [];
  }

  const resolved = new Map<string, ResolvedSkillAttachment>();

  for (const rule of rules) {
    if (!matchesSkillAttachmentRule(triggerText, rule)) {
      continue;
    }

    const key = attachmentKey(rule.owner, rule.skillName);
    if (resolved.has(key)) {
      continue;
    }

    const skillsDir = getSkillsDir(rule.owner, "xml");
    const content = readSkillContent(skillsDir, rule.skillName);
    resolved.set(key, {
      owner: rule.owner,
      skillName: rule.skillName,
      content,
    });
  }

  return Array.from(resolved.values());
};

export const appendConfiguredSkillAttachments = (
  basePrompt: string,
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
): string => {
  const rules = definition.skillAttachments ?? [];
  if (rules.length === 0) {
    return basePrompt;
  }

  const attachments = resolveSkillAttachments(rules, messages);
  if (attachments.length === 0) {
    return basePrompt;
  }

  const attachmentPrompt = formatAttachedSkillsPrompt(
    attachments.map(({ skillName, content }) => ({ skillName, content })),
  );

  return `${basePrompt}\n\n${attachmentPrompt}`;
};

export const FINANCE_SKILL_ATTACHMENTS: SkillAttachmentRule[] = [
  {
    owner: "finance",
    skillName: "sync-expenses",
    match: {
      anyPhrases: [
        "get yesterday transactions",
        "get today transactions",
        "show yesterday transactions",
        "show today transactions",
        "list yesterday transactions",
        "list today transactions",
        "yesterday transactions",
        "today transactions",
        "yesterday expenses",
        "today expenses",
        "summarize expenses",
        "summarize spending",
        "how much spent",
        "total spending",
        "view expenses",
        "list expenses",
        "show expenses",
      ],
    },
  },
];

export const ROUTINE_SKILL_ATTACHMENTS: SkillAttachmentRule[] = [
  {
    owner: "obsidian",
    skillName: "Routine",
    cronJobName: "routine-note-creation",
    match: {
      anyPhrases: [
        "routine",
        "todos",
        "todo",
        "daily note",
        "daily routine",
        "unchecked",
        "carry forward",
        "carry-over",
      ],
    },
  },
  {
    owner: "obsidian",
    skillName: "Routine",
    match: {
      allPhrases: ["task"],
      anyPhrases: [
        "today",
        "yesterday",
        "daily",
        "routine",
        "move",
        "carry",
        "forward",
        "unchecked",
      ],
    },
  },
  {
    owner: "obsidian",
    skillName: "Routine",
    match: {
      allPhrases: ["plan"],
      anyPhrases: ["today", "tomorrow", "yesterday"],
    },
  },
];

export const getAttachedSkillNames = (
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
): Set<string> =>
  new Set(resolveSkillAttachments(definition.skillAttachments ?? [], messages).map((attachment) => attachment.skillName));
