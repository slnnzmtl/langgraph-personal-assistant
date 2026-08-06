import type { BaseMessage } from "@langchain/core/messages";

import { resolveAgentSkillModule } from "../../core/types/agent.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import { appendConfiguredSkillAttachments } from "../../core/skills/skill-attachments.js";
import {
  appendRuntimeExecutionModel,
  RUNTIME_EXECUTION_MODEL,
} from "../../core/skills/prompt-enrichment.js";

export type RuntimePromptParts = {
  staticPrompt: string;
  dynamicPrompt: string;
};

/** Domain/base prompt only — keep stable for Gemini context cache. */
export const buildStaticRuntimePrompt = (basePrompt: string): string =>
  basePrompt.trim();

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

  // Append last so parallel-tool guidance outranks sequential skill step lists.
  const body = sections.join("\n\n").trim();
  return body.length > 0 ? appendRuntimeExecutionModel(body) : RUNTIME_EXECUTION_MODEL;
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
