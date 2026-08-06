import type { BaseMessage } from "@langchain/core/messages";

import { resolveAgentSkillModule } from "../types/agent.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { SkillCatalog } from "./catalog.js";
import { appendConfiguredSkillAttachments } from "./skill-attachments.js";

export const RUNTIME_EXECUTION_MODEL = `<runtime_execution>
- You run in an automatic tool loop: after tool results, you are invoked again until you reply with plain text or stop calling tools.
- Tool schemas define only tool arguments. Never emit extra control flags or parameters not in a tool schema.
- Prefer multiple tool calls in the same turn when operations are independent (e.g. load two skills, run two reads/searches, list + preview unrelated resources). Do not wait for a reply turn between independent lookups.
- Numbered or ordered skill steps that are independent still MUST be emitted together in one turn. Sequence only when a later call needs a prior result (e.g. read/search before overwrite write; list then pick an id then mutate).
- Prior tool results are already in message history as tool messages — use them directly; do not restate or manually track step state.
- Never return an empty turn (no text and no tool calls).
</runtime_execution>`;

export const appendAvailableSkills = (
  basePrompt: string,
  module: string,
  skillCatalog: SkillCatalog,
): string => {
  const skills = skillCatalog.listSkills({ module });
  const skillsBlock = skillCatalog.formatForPrompt(skills);

  if (skillsBlock.length === 0) {
    return basePrompt;
  }

  return `${basePrompt.trim()}\n\n${skillsBlock}`;
};

export const appendRuntimeExecutionModel = (prompt: string): string =>
  `${prompt.trim()}\n\n${RUNTIME_EXECUTION_MODEL}`;

export const enrichRuntimeAgentPrompt = (
  basePrompt: string,
  definition: RuntimeAgentDefinition,
  messages: BaseMessage[],
  skillCatalog?: SkillCatalog,
): string => {
  let prompt = basePrompt.trim();

  if (skillCatalog) {
    const module = resolveAgentSkillModule(definition);
    const skillModules = new Set(skillCatalog.listModules());
    prompt = appendAvailableSkills(prompt, module, skillCatalog);
    prompt = appendConfiguredSkillAttachments(prompt, definition, messages, skillCatalog);

    if (skillModules.has(module)) {
      prompt = appendRuntimeExecutionModel(prompt);
    }

    return prompt;
  }

  return appendConfiguredSkillAttachments(prompt, definition, messages, skillCatalog);
};
