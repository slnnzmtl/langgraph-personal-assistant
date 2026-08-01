import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../message-content.js";
import { resolveAgentSkillModule } from "../types/agent.js";
import { SUB_AGENT_CONTEXT_HUMAN_TURNS } from "../execution/sub-agent-messages.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { SkillAttachmentRule, SkillCatalog } from "./catalog.js";
import { loadSkillAttachmentRules, readSkillContent } from "./skills-loader.js";
import { resolveActiveSkillFromHistory } from "./skill-history.js";

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
  module: string;
  skillName: string;
  content: string;
};

const attachmentKey = (module: string, skillName: string): string =>
  `${module.toLowerCase()}:${skillName.toLowerCase()}`;

const readSkillAttachmentContent = (
  module: string,
  skillName: string,
  skillCatalog?: SkillCatalog,
): string =>
  skillCatalog
    ? skillCatalog.readContent(skillName, { module })
    : readSkillContent(skillName, { module });

const addSkillAttachment = (
  resolved: Map<string, ResolvedSkillAttachment>,
  module: string,
  skillName: string,
  skillCatalog?: SkillCatalog,
): void => {
  const key = attachmentKey(module, skillName);
  if (resolved.has(key)) {
    return;
  }

  resolved.set(key, {
    module,
    skillName,
    content: readSkillAttachmentContent(module, skillName, skillCatalog),
  });
};

export const resolveSkillAttachmentRulesForModule = (
  module: string,
  skillCatalog?: SkillCatalog,
): SkillAttachmentRule[] => {
  if (skillCatalog && "loadAttachmentRules" in skillCatalog) {
    return (skillCatalog as SkillCatalog & { loadAttachmentRules: (module: string) => SkillAttachmentRule[] })
      .loadAttachmentRules(module);
  }

  return loadSkillAttachmentRules(module);
};

export type ResolveSkillAttachmentsOptions = {
  skillCatalog?: SkillCatalog | undefined;
};

export const resolveSkillAttachments = (
  rules: SkillAttachmentRule[],
  messages: BaseMessage[],
  options: ResolveSkillAttachmentsOptions = {},
): ResolvedSkillAttachment[] => {
  const skillCatalog = options.skillCatalog;

  const triggerTexts = extractRecentHumanTexts(messages);
  if (triggerTexts.length === 0) {
    return [];
  }

  const resolved = new Map<string, ResolvedSkillAttachment>();
  const rulesBySkillName = new Map(
    rules.map((rule) => [rule.skillName.toLowerCase(), rule]),
  );

  for (const rule of rules) {
    const matched = triggerTexts.some((text) => matchesSkillAttachmentRule(text, rule));
    if (!matched) {
      continue;
    }

    addSkillAttachment(resolved, rule.module, rule.skillName, skillCatalog);
  }

  const activeSkill = resolveActiveSkillFromHistory(messages);
  if (activeSkill) {
    const stickyRule = rulesBySkillName.get(activeSkill.skillName);
    if (stickyRule) {
      addSkillAttachment(resolved, stickyRule.module, stickyRule.skillName, skillCatalog);
    }
  }

  return Array.from(resolved.values());
};

export const appendConfiguredSkillAttachments = (
  basePrompt: string,
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
  skillCatalog?: SkillCatalog,
): string => {
  const lastMessage = messages.at(-1);
  if (lastMessage instanceof ToolMessage) {
    return basePrompt;
  }

  const module = resolveAgentSkillModule(definition);
  const rules = resolveSkillAttachmentRulesForModule(module, skillCatalog);
  if (rules.length === 0) {
    return basePrompt;
  }

  const attachments = resolveSkillAttachments(rules, messages, { skillCatalog });
  if (attachments.length === 0) {
    return basePrompt;
  }

  const attachmentPrompt = formatAttachedSkillsPrompt(
    attachments.map(({ skillName, content }) => ({ skillName, content })),
  );

  return `${basePrompt}\n\n${attachmentPrompt}`;
};

export const getAttachedSkillNames = (
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
  skillCatalog?: SkillCatalog,
): Set<string> => {
  const module = resolveAgentSkillModule(definition);

  return new Set(
    resolveSkillAttachments(
      resolveSkillAttachmentRulesForModule(module, skillCatalog),
      messages,
      { skillCatalog },
    ).map((attachment) => attachment.skillName),
  );
};
