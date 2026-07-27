import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { SkillCatalog } from "../../../core/skills/catalog.js";

const ListSkillsToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to list skills for"),
});

const PreviewSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to preview or edit"),
  name: z.string().describe("The name of the skill to preview or edit"),
});

const CreateSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to create the skill under"),
  name: z.string().min(1).describe("The skill name used in frontmatter and as the filename"),
  description: z.string().min(1).describe("Short description shown in available skills lists"),
  content: z.string().min(1).describe("Full skill body for the skill"),
});

const EditSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module that owns the skill"),
  name: z.string().min(1).describe("The existing skill name to update"),
  description: z.string().min(1).describe("Replacement description for the skill"),
  content: z.string().min(1).describe("Replacement skill body"),
});

const DeleteSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module that owns the skill"),
  name: z.string().min(1).describe("The skill name to delete"),
});

export type SkillCrudToolsOptions = {
  skillCatalog: SkillCatalog;
  writeAccess?: boolean;
};

const assertKnownModule = (module: string, skillCatalog: SkillCatalog): void => {
  const modules = skillCatalog.listModules();
  if (!modules.includes(module)) {
    throw new Error(`Unknown skill module: ${module}`);
  }
};

const formatSkillPreview = (skillCatalog: SkillCatalog, module: string, name: string): string => {
  const skill = skillCatalog.readFull(name, { module });
  return [
    `Name: ${skill.name}`,
    `Module: ${skill.module ?? module}`,
    `Description: ${skill.description}`,
    "",
    skill.body,
  ].join("\n");
};

export const createSkillCrudTools = (
  options: SkillCrudToolsOptions,
): StructuredToolInterface[] => {
  const { skillCatalog } = options;

  const listSkillsTool = tool(
    async (input: z.infer<typeof ListSkillsToolSchema>) => {
      try {
        assertKnownModule(input.module, skillCatalog);
        const skills = skillCatalog.listSkills({ module: input.module });
        return skillCatalog.formatForDisplay(input.module, skills, "Listed");
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

  const previewSkillTool = tool(
    async (input: z.infer<typeof PreviewSkillToolSchema>) => {
      try {
        assertKnownModule(input.module, skillCatalog);
        return formatSkillPreview(skillCatalog, input.module, input.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "preview_skill",
      description:
        "Load the full skill file for preview or before editing. Use for show/read/view requests and as the first step before edit_skill.",
      schema: PreviewSkillToolSchema,
    },
  );

  const readTools = [listSkillsTool, previewSkillTool];

  const writeAccess = options.writeAccess ?? true;
  if (!writeAccess) {
    return readTools;
  }

  const createSkillTool = tool(
    async (input: z.infer<typeof CreateSkillToolSchema>) => {
      try {
        const filePath = skillCatalog.createSkill(
          input.name,
          input.description,
          input.content,
          input.module,
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
        assertKnownModule(input.module, skillCatalog);
        const filePath = skillCatalog.updateSkill(
          input.name,
          input.description,
          input.content,
          input.module,
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
        assertKnownModule(input.module, skillCatalog);
        const fileName = skillCatalog.deleteSkill(input.name, input.module);
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

  return [...readTools, createSkillTool, editSkillTool, deleteSkillTool];
};
