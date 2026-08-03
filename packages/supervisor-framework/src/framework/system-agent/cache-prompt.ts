import type { BaseMessage } from "@langchain/core/messages";

import { resolveAgentSkillModule } from "../../core/types/agent.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import { appendConfiguredSkillAttachments } from "../../core/skills/skill-attachments.js";
import { appendRuntimeExecutionModel } from "../../core/skills/prompt-enrichment.js";

export type RuntimePromptParts = {
  staticPrompt: string;
  dynamicPrompt: string;
};

export const buildStaticRuntimePrompt = (basePrompt: string): string =>
  appendRuntimeExecutionModel(basePrompt.trim());

export const buildDynamicRuntimePrompt = (
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
  skillCatalog: SkillCatalog,
  systemMetadata: string,
  extraDynamicSections: readonly string[] = [],
): string => {
  const module = resolveAgentSkillModule(definition);
  const sections: string[] = [];

  const skills = skillCatalog.listSkills({ module });
  const skillsBlock = skillCatalog.formatForPrompt(skills);
  if (skillsBlock.length > 0) {
    sections.push(skillsBlock);
  }

  const withAttachments = appendConfiguredSkillAttachments(
    sections.join("\n\n"),
    definition,
    messages,
    skillCatalog,
  ).trim();

  if (withAttachments.length > 0) {
    sections.length = 0;
    sections.push(withAttachments);
  }

  for (const extra of extraDynamicSections) {
    const trimmed = extra.trim();
    if (trimmed.length > 0) {
      sections.push(trimmed);
    }
  }

  const metadata = systemMetadata.trim();
  if (metadata.length > 0) {
    sections.push(metadata);
  }

  return sections.join("\n\n").trim();
};

export const buildRuntimePromptParts = (
  basePrompt: string,
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
  skillCatalog: SkillCatalog,
  systemMetadata: string,
  extraDynamicSections: readonly string[] = [],
): RuntimePromptParts => ({
  staticPrompt: buildStaticRuntimePrompt(basePrompt),
  dynamicPrompt: buildDynamicRuntimePrompt(
    definition,
    messages,
    skillCatalog,
    systemMetadata,
    extraDynamicSections,
  ),
});

export {
  buildCachedRuntimePromptMessages,
  buildTurnContextMessage,
} from "../../core/supervisor/cache-prompt-messages.js";
