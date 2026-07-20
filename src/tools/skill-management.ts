import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  SKILLS_ROOT,
  createSkillFile,
  deleteSkillFile,
  formatSkillsForDisplay,
  listSkills,
  readFullSkill,
  readSkillContent,
  serializeSkillFile,
  updateSkillFile,
} from "../prompts/skills-loader.js";
import { enrichSkillWithActions, type SkillActionRegistry } from "./skill-actions.js";
import { truncateToolOutput } from "./output.js";
import { BUILTIN_DOMAIN_IDS } from "../runtime-agents/builtin-domains.js";

export type SkillModule = (typeof BUILTIN_DOMAIN_IDS)[number];

const SkillModuleSchema = z.enum(
  BUILTIN_DOMAIN_IDS as unknown as [SkillModule, ...SkillModule[]],
);

export const ReadSkillToolSchema = z.object({
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const ListSkillsToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
});

export const ConfigurationReadSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const PreviewSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
  name: z.string().describe("The name of the skill to preview (e.g., 'sync-expenses')"),
});

export const CreateSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
  name: z.string().min(1).describe("The skill name used in frontmatter and as the filename"),
  description: z.string().min(1).describe("Short description shown in available skills lists"),
  content: z.string().min(1).describe("Full skill body for the skill"),
});

export const EditSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
  name: z.string().min(1).describe("The existing skill name to update"),
  description: z.string().min(1).describe("Replacement description for the skill"),
  content: z.string().min(1).describe("Replacement skill body"),
});

export const DeleteSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module (e.g., 'finance', 'obsidian', 'configuration')"),
  name: z.string().min(1).describe("The skill name to delete"),
});

export type ReadSkillToolOptions = {
  actionRegistry?: SkillActionRegistry;
};

export type SkillCrudToolsOptions = {
  skillsDir?: string;
};

const resolveSkillsDir = (options?: SkillCrudToolsOptions): string =>
  options?.skillsDir ?? SKILLS_ROOT;

const formatSkillList = (module: SkillModule, skillsDir: string): string => {
  const skills = listSkills({ module, skillsDir });
  return formatSkillsForDisplay(module, skills, "Listed");
};

const formatSkillPreview = (module: SkillModule, skillsDir: string, name: string): string => {
  const skill = readFullSkill(name, { module, skillsDir });
  return truncateToolOutput(
    serializeSkillFile(
      { name: skill.name, description: skill.description, module: skill.module ?? module },
      skill.body,
      skill.fileName,
    ),
  );
};

const enrichSkillContent = async (
  content: string,
  promptKey: string,
  skillName: string,
  options?: ReadSkillToolOptions,
): Promise<string> =>
  enrichSkillWithActions({
    content,
    promptKey,
    skillName,
    ...(options?.actionRegistry ? { actionRegistry: options.actionRegistry } : {}),
  });

export const createReadSkillTool = (
  promptKey: string,
  _fileType: "md" | "xml" = "md",
  options?: ReadSkillToolOptions,
): StructuredToolInterface =>
  tool(
    async (input: z.infer<typeof ReadSkillToolSchema>) => {
      try {
        const content = readSkillContent(input.name, { module: promptKey });
        const enriched = await enrichSkillContent(content, promptKey, input.name, options);
        return truncateToolOutput(enriched);
      } catch (error) {
        const availableSkills = listSkills({ module: promptKey });
        const skillNames = availableSkills.map((skill) => skill.name).join(", ");
        const message = error instanceof Error ? error.message : String(error);
        return `Error reading skill: ${message}\nAvailable skills: ${skillNames || "none"}`;
      }
    },
    {
      name: "read_skill",
      description:
        "Load the full step-by-step instructions for a named skill before performing it. Pass the skill name exactly.",
      schema: ReadSkillToolSchema,
    },
  );

export const createSkillCrudTools = (
  options?: SkillCrudToolsOptions,
): StructuredToolInterface[] => {
  const skillsDir = resolveSkillsDir(options);

  const listSkillsTool = tool(
    async (input: z.infer<typeof ListSkillsToolSchema>) => {
      try {
        return formatSkillList(input.module, skillsDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "list_skills",
      description: "List all skills configured for a skill module.",
      schema: ListSkillsToolSchema,
    },
  );

  const readSkillForEditTool = tool(
    async (input: z.infer<typeof ConfigurationReadSkillToolSchema>) => {
      try {
        return formatSkillPreview(input.module, skillsDir, input.name);
      } catch (error) {
        const availableSkills = listSkills({ module: input.module, skillsDir });
        const skillNames = availableSkills.map((skill) => skill.name).join(", ");
        const message = error instanceof Error ? error.message : String(error);
        return `Error reading skill: ${message}\nAvailable skills: ${skillNames || "none"}`;
      }
    },
    {
      name: "read_skill_for_edit",
      description:
        "Load the full skill file for a named module and skill before editing it.",
      schema: ConfigurationReadSkillToolSchema,
    },
  );

  const previewSkillTool = tool(
    async (input: z.infer<typeof PreviewSkillToolSchema>) => {
      try {
        return formatSkillPreview(input.module, skillsDir, input.name);
      } catch (error) {
        const availableSkills = listSkills({ module: input.module, skillsDir });
        const skillNames = availableSkills.map((skill) => skill.name).join(", ");
        const message = error instanceof Error ? error.message : String(error);
        return `Error previewing skill: ${message}\nAvailable skills: ${skillNames || "none"}`;
      }
    },
    {
      name: "preview_skill",
      description:
        "Preview a skill file for display to the user. Use for show/read/view requests. Does not execute the skill.",
      schema: PreviewSkillToolSchema,
    },
  );

  const createSkillTool = tool(
    async (input: z.infer<typeof CreateSkillToolSchema>) => {
      try {
        const filePath = createSkillFile(
          input.name,
          input.description,
          input.content,
          input.module,
          skillsDir,
        );
        return `Created skill ${input.name} for module ${input.module}.\nPath: ${filePath}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_skill",
      description: "Create and persist a new skill for a skill module.",
      schema: CreateSkillToolSchema,
    },
  );

  const editSkillTool = tool(
    async (input: z.infer<typeof EditSkillToolSchema>) => {
      try {
        const filePath = updateSkillFile(
          input.name,
          input.description,
          input.content,
          input.module,
          skillsDir,
        );
        return `Updated skill ${input.name} for module ${input.module}.\nPath: ${filePath}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "edit_skill",
      description: "Replace an existing skill's description and body for a skill module.",
      schema: EditSkillToolSchema,
    },
  );

  const deleteSkillTool = tool(
    async (input: z.infer<typeof DeleteSkillToolSchema>) => {
      try {
        const fileName = deleteSkillFile(input.name, skillsDir);
        return `Deleted skill ${input.name} for module ${input.module}.\nFile: ${fileName}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "delete_skill",
      description: "Delete a persisted skill for a skill module.",
      schema: DeleteSkillToolSchema,
    },
  );

  return [
    listSkillsTool,
    previewSkillTool,
    readSkillForEditTool,
    createSkillTool,
    editSkillTool,
    deleteSkillTool,
  ];
};
