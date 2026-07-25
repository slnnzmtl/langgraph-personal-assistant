import {
  resolveAgentSkillModule,
  type RuntimeAgentDefinition,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";

export const RUNTIME_EXECUTION_MODEL = `<runtime_execution>
- You run in an automatic tool loop: after tool results, you are invoked again until you reply with plain text or stop calling tools.
- Tool schemas define only tool arguments. Never emit extra control flags or parameters not in a tool schema.
- Parallel tool calls are supported when operations are independent. Sequence calls only when one depends on another's result (e.g., read before overwrite write).
- Prior tool results are already in message history as tool messages — use them directly; do not restate or manually track step state.
- Never return an empty turn (no text and no tool calls).
</runtime_execution>`;

const READ_SKILL_HINT =
  "Call read_skill(skill_name) to load a skill's full step-by-step instructions before performing it.";

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

  return `${basePrompt.trim()}\n\n${skillsBlock}\n\n${READ_SKILL_HINT}`;
};

export const appendRuntimeExecutionModel = (prompt: string): string =>
  `${prompt.trim()}\n\n${RUNTIME_EXECUTION_MODEL}`;

export const enrichRuntimeAgentPrompt = (
  basePrompt: string,
  definition: RuntimeAgentDefinition,
  skillCatalog?: SkillCatalog,
): string => {
  if (!skillCatalog) {
    return basePrompt.trim();
  }

  const module = resolveAgentSkillModule(definition);
  const skillModules = new Set(skillCatalog.listModules());
  let prompt = appendAvailableSkills(basePrompt, module, skillCatalog);

  if (skillModules.has(module)) {
    prompt = appendRuntimeExecutionModel(prompt);
  }

  return prompt;
};
