import type { BaseMessage } from "@langchain/core/messages";

import { resolveAgentSkillModule } from "../types/agent.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { SkillCatalog } from "./catalog.js";

export const RUNTIME_EXECUTION_MODEL = `<runtime_execution>
- You run in an automatic tool loop: after tool results, you are invoked again until you reply with plain text or stop calling tools.
- Tool schemas define only tool arguments. Never emit extra control flags or parameters not in a tool schema.
- Parallel tool calls are supported when operations are independent. Sequence calls only when one depends on another's result (e.g., read before overwrite write).
- Prior tool results are already in message history as tool messages — use them directly; do not restate or manually track step state.
- Never return an empty turn (no text and no tool calls).
</runtime_execution>`;

/** Universal skill-usage contract injected for every runtime agent. */
export const SKILL_USAGE_GUIDE = `<skill_usage>
- Skills in <available_skills> are catalog entries only. Load full instructions with read_skill(skill_name) before multi-step work unless the skill body is already in <attached_skills>.
- When a skill is already in <attached_skills>, follow it immediately; do not call read_skill again unless the instructions are missing or stale.
- read_skill is internal only: it loads execution instructions. Never use it to display a skill definition to the user.
</skill_usage>`;

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

  return `${basePrompt.trim()}\n\n${skillsBlock}\n\n${SKILL_USAGE_GUIDE}`;
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

  // Skill auto-attachment disabled; agents use read_skill. Re-enable via appendConfiguredSkillAttachments.
  void messages;

  if (skillCatalog) {
    const module = resolveAgentSkillModule(definition);
    const skillModules = new Set(skillCatalog.listModules());
    prompt = appendAvailableSkills(prompt, module, skillCatalog);

    if (skillModules.has(module)) {
      prompt = appendRuntimeExecutionModel(prompt);
    }

    return prompt;
  }

  return prompt;
};
