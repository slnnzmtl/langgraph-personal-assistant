import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getSkillsDir } from "../prompts/load-system-prompt.js";
import {
  createSkillFile,
  deleteSkillFile,
  formatSkillFile,
  listSkills,
  readFullSkill,
  readSkillContent,
  updateSkillFile,
} from "../prompts/skills-loader.js";
import { enrichSkillWithActions, type SkillActionRegistry } from "./skill-actions.js";
import { truncateToolOutput } from "./output.js";

export const SKILL_OWNERS = ["finance", "obsidian", "configurator"] as const;
export type SkillOwner = (typeof SKILL_OWNERS)[number];

const SkillOwnerSchema = z.enum(SKILL_OWNERS);

export const ReadSkillToolSchema = z.object({
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const ListSkillsToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
});

export const ConfiguratorReadSkillToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const PreviewSkillToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
  name: z.string().describe("The name of the skill to preview (e.g., 'sync-expenses')"),
});

export const CreateSkillToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
  name: z.string().min(1).describe("The skill name used in frontmatter and as the filename"),
  description: z.string().min(1).describe("Short description shown in available skills lists"),
  content: z.string().min(1).describe("Full markdown body for the skill"),
});

export const EditSkillToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
  name: z.string().min(1).describe("The existing skill name to update"),
  description: z.string().min(1).describe("Replacement description for the skill"),
  content: z.string().min(1).describe("Replacement markdown body for the skill"),
});

export const DeleteSkillToolSchema = z.object({
  owner: SkillOwnerSchema.describe("The skill owner (e.g., 'finance', 'obsidian', 'configurator')"),
  name: z.string().min(1).describe("The skill name to delete"),
});

export type ReadSkillToolOptions = {
  actionRegistry?: SkillActionRegistry;
};

export type SkillCrudToolsOptions = {
  resolveSkillsDir?: (owner: SkillOwner) => string;
};

const resolveOwnerSkillsDir = (
  owner: SkillOwner,
  resolveSkillsDir?: (owner: SkillOwner) => string,
): string => {
  if (!SKILL_OWNERS.includes(owner)) {
    throw new Error(`Unknown skill owner: ${owner}`);
  }

  return resolveSkillsDir ? resolveSkillsDir(owner) : getSkillsDir(owner);
};

const formatSkillList = (owner: SkillOwner, skillsDir: string): string => {
  const skills = listSkills(skillsDir);
  if (skills.length === 0) {
    return `No skills configured for ${owner}.`;
  }

  return skills.map((skill) => `${skill.name}: ${skill.description}`).join("\n");
};

const formatSkillPreview = (skillsDir: string, name: string): string => {
  const skill = readFullSkill(skillsDir, name);
  return truncateToolOutput(
    formatSkillFile({ name: skill.name, description: skill.description }, skill.body),
  );
};

export const createReadSkillTool = (
  promptKey: string,
  fileType: "md" | "xml" = "md",
  options?: ReadSkillToolOptions,
): StructuredToolInterface =>
  tool(
    async (input: z.infer<typeof ReadSkillToolSchema>) => {
      const skillsDir = getSkillsDir(promptKey, fileType);

      try {
        const content = readSkillContent(skillsDir, input.name);
        const enriched = await enrichSkillWithActions({
          content,
          promptKey,
          skillName: input.name,
          ...(options?.actionRegistry ? { actionRegistry: options.actionRegistry } : {}),
        });
        return truncateToolOutput(enriched);
      } catch (error) {
        const availableSkills = listSkills(skillsDir);
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
  const resolveSkillsDir = (owner: SkillOwner) =>
    resolveOwnerSkillsDir(owner, options?.resolveSkillsDir);

  const listSkillsTool = tool(
    async (input: z.infer<typeof ListSkillsToolSchema>) => {
      try {
        const skillsDir = resolveSkillsDir(input.owner);
        return formatSkillList(input.owner, skillsDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "list_skills",
      description: "List all skills configured for a skill owner.",
      schema: ListSkillsToolSchema,
    },
  );

  const readSkillTool = tool(
    async (input: z.infer<typeof ConfiguratorReadSkillToolSchema>) => {
      try {
        const skillsDir = resolveSkillsDir(input.owner);
        return formatSkillPreview(skillsDir, input.name);
      } catch (error) {
        const skillsDir = resolveSkillsDir(input.owner);
        const availableSkills = listSkills(skillsDir);
        const skillNames = availableSkills.map((skill) => skill.name).join(", ");
        const message = error instanceof Error ? error.message : String(error);
        return `Error reading skill: ${message}\nAvailable skills: ${skillNames || "none"}`;
      }
    },
    {
      name: "read_skill",
      description:
        "Load the full skill file for a named owner and skill before editing it.",
      schema: ConfiguratorReadSkillToolSchema,
    },
  );

  const previewSkillTool = tool(
    async (input: z.infer<typeof PreviewSkillToolSchema>) => {
      try {
        const skillsDir = resolveSkillsDir(input.owner);
        return formatSkillPreview(skillsDir, input.name);
      } catch (error) {
        const skillsDir = resolveSkillsDir(input.owner);
        const availableSkills = listSkills(skillsDir);
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
        const skillsDir = resolveSkillsDir(input.owner);
        const filePath = createSkillFile(
          skillsDir,
          input.name,
          input.description,
          input.content,
        );
        return `Created skill ${input.name} for ${input.owner}.\nPath: ${filePath}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "create_skill",
      description: "Create and persist a new skill for a skill owner.",
      schema: CreateSkillToolSchema,
    },
  );

  const editSkillTool = tool(
    async (input: z.infer<typeof EditSkillToolSchema>) => {
      try {
        const skillsDir = resolveSkillsDir(input.owner);
        const filePath = updateSkillFile(
          skillsDir,
          input.name,
          input.description,
          input.content,
        );
        return `Updated skill ${input.name} for ${input.owner}.\nPath: ${filePath}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "edit_skill",
      description: "Replace an existing skill's description and body for a skill owner.",
      schema: EditSkillToolSchema,
    },
  );

  const deleteSkillTool = tool(
    async (input: z.infer<typeof DeleteSkillToolSchema>) => {
      try {
        const skillsDir = resolveSkillsDir(input.owner);
        const fileName = deleteSkillFile(skillsDir, input.name);
        return `Deleted skill ${input.name} for ${input.owner}.\nFile: ${fileName}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    },
    {
      name: "delete_skill",
      description: "Delete a persisted skill for a skill owner.",
      schema: DeleteSkillToolSchema,
    },
  );

  return [listSkillsTool, previewSkillTool, readSkillTool, createSkillTool, editSkillTool, deleteSkillTool];
};
