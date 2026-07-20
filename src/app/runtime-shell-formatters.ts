import {
  appendDynamicSections,
  formatObsidianRoutineHint,
  formatSystemMetadata,
} from "../prompts/load-system-prompt.js";
import {
  appendConfiguredSkillAttachments,
  getAttachedSkillNames,
} from "../runtime-agents/skill-attachments.js";
import type { RuntimeShellFormatters } from "../core/system-context.js";
import type { SkillCatalog } from "../core/skills/catalog.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => ({
  formatSystemMetadata,
  appendDynamicSections,
  appendSkillAttachments: (basePrompt, definition, messages) =>
    appendConfiguredSkillAttachments(basePrompt, definition, messages, skillCatalog),
});

export { getAttachedSkillNames, formatObsidianRoutineHint };
