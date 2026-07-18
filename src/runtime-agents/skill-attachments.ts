import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { SUB_AGENT_CONTEXT_HUMAN_TURNS } from "../core/execution/sub-agent-messages.js";
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
  const recent = extractRecentHumanTexts(messages, 1);
  return recent[0];
};

/** Recent non-empty human texts, oldest → newest, capped to the sub-agent context window. */
export const extractRecentHumanTexts = (
  messages: BaseMessage[],
  humanTurns = SUB_AGENT_CONTEXT_HUMAN_TURNS,
): string[] => {
  const texts: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof HumanMessage)) {
      continue;
    }

    const text = extractMessageTextContent(message.content).trim();
    if (text.length === 0) {
      continue;
    }

    texts.push(text);
    if (texts.length >= Math.max(1, humanTurns)) {
      break;
    }
  }

  return texts.reverse();
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
  // Match against recent human turns so short follow-ups ("for yesterday") keep
  // the skill attached after an earlier matching request ("sync expenses").
  const triggerTexts = extractRecentHumanTexts(messages);
  if (triggerTexts.length === 0) {
    return [];
  }

  const resolved = new Map<string, ResolvedSkillAttachment>();

  for (const rule of rules) {
    const matched = triggerTexts.some((text) => matchesSkillAttachmentRule(text, rule));
    if (!matched) {
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
        "sync expenses",
        "sync expense",
        "transactions",
        "spending",
        "how much spent",
        "total spending",
        "expense",
        "expenses",
        "for yesterday",
        "for today",
        "yesterday expenses",
        "today expenses",
        "yesterday transactions",
        "today transactions",
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
        // "daily note",
        "daily",
        "plan",
        "plans",
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
