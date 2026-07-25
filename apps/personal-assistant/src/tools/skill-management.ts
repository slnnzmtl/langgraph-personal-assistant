import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  SKILLS_ROOT,
  createSkillFile,
  deleteSkillFile,
  formatSkillsForDisplay,
  listSkillModules,
  listSkills,
  readFullSkill,
  readSkillContent,
  serializeSkillFile,
  updateSkillFile,
} from "../runtime-agents/skills/skills-loader.js";
import type { SkillCatalog } from "@personal-assistant/supervisor-framework";
import { enrichSkillWithActions, type SkillActionRegistry } from "./skill-actions.js";
import { truncateToolOutput } from "./output.js";

export type SkillModule = string;

const SkillModuleSchema = z.string().min(1);

export const ReadSkillToolSchema = z.object({
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const ListSkillsToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to list skills for"),
});

export const ConfigurationReadSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to read from"),
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const PreviewSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module to preview"),
  name: z.string().describe("The name of the skill to preview (e.g., 'sync-expenses')"),
});

export const CreateSkillToolSchema = z.object({
  module: SkillModuleSchema.describe("The skill module to create the skill under"),
  name: z.string().min(1).describe("The skill name used in frontmatter and as the filename"),
  description: z.string().min(1).describe("Short description shown in available skills lists"),
  content: z.string().min(1).describe("Full skill body for the skill"),
});

export const EditSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module that owns the skill"),
  name: z.string().min(1).describe("The existing skill name to update"),
  description: z.string().min(1).describe("Replacement description for the skill"),
  content: z.string().min(1).describe("Replacement skill body"),
});

export const DeleteSkillToolSchema = z.object({
  module: z.string().min(1).describe("The skill module that owns the skill"),
  name: z.string().min(1).describe("The skill name to delete"),
});

export type ReadSkillToolOptions = {
  actionRegistry?: SkillActionRegistry;
  skillCatalog?: SkillCatalog;
};

export type SkillCrudToolsOptions = {
  skillsDir?: string;
  skillCatalog?: SkillCatalog;
  writeAccess?: boolean;
};

const resolveSkillsDir = (options?: SkillCrudToolsOptions): string =>
  options?.skillsDir ?? SKILLS_ROOT;

const resolveModules = (options?: SkillCrudToolsOptions): string[] =>
  options?.skillCatalog?.listModules()
  ?? listSkillModules({ skillsDir: resolveSkillsDir(options) });

const assertKnownModule = (module: string, options?: SkillCrudToolsOptions): void => {
  const modules = resolveModules(options);
  if (!modules.includes(module)) {
    throw new Error(`Unknown skill module: ${module}`);
  }
};

const formatSkillList = (
  module: SkillModule,
  options?: SkillCrudToolsOptions,
): string => {
  if (options?.skillCatalog) {
    const skills = options.skillCatalog.listSkills({ module });
    return options.skillCatalog.formatForDisplay(module, skills, "Listed");
  }

  const skillsDir = resolveSkillsDir(options);
  const skills = listSkills({ module, skillsDir });
  return formatSkillsForDisplay(module, skills, "Listed");
};

const formatSkillPreview = (
  module: SkillModule,
  name: string,
  options?: SkillCrudToolsOptions,
): string => {
  if (options?.skillCatalog) {
    const skill = options.skillCatalog.readFull(name, { module });
    return truncateToolOutput(
      serializeSkillFile(
        { name: skill.name, description: skill.description, module: skill.module ?? module },
        skill.body,
        skill.fileName,
      ),
    );
  }

  const skillsDir = resolveSkillsDir(options);
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
        const content = options?.skillCatalog
          ? options.skillCatalog.readContent(input.name, { module: promptKey })
          : readSkillContent(input.name, { module: promptKey });
        const enriched = await enrichSkillContent(content, promptKey, input.name, options);
        return truncateToolOutput(enriched);
      } catch (error) {
        const availableSkills = options?.skillCatalog
          ? options.skillCatalog.listSkills({ module: promptKey })
          : listSkills({ module: promptKey });
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
  const listSkillsTool = tool(
    async (input: z.infer<typeof ListSkillsToolSchema>) => {
      try {
        assertKnownModule(input.module, options);
        return formatSkillList(input.module, options);
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
        assertKnownModule(input.module, options);
        return formatSkillPreview(input.module, input.name, options);
      } catch (error) {
        const availableSkills = options?.skillCatalog
          ? options.skillCatalog.listSkills({ module: input.module })
          : listSkills({ module: input.module, skillsDir: resolveSkillsDir(options) });
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

  const readSkillForEditTool = tool(
    async (input: z.infer<typeof ConfigurationReadSkillToolSchema>) => {
      try {
        assertKnownModule(input.module, options);
        return formatSkillPreview(input.module, input.name, options);
      } catch (error) {
        const availableSkills = options?.skillCatalog
          ? options.skillCatalog.listSkills({ module: input.module })
          : listSkills({ module: input.module, skillsDir: resolveSkillsDir(options) });
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

  const readTools = [listSkillsTool, previewSkillTool, readSkillForEditTool];

  const writeAccess = options?.writeAccess ?? true;
  if (!writeAccess) {
    return readTools;
  }

  const createSkillTool = tool(
    async (input: z.infer<typeof CreateSkillToolSchema>) => {
      try {
        const filePath = options?.skillCatalog
          ? options.skillCatalog.createSkill(input.name, input.description, input.content, input.module)
          : createSkillFile(
            input.name,
            input.description,
            input.content,
            input.module,
            resolveSkillsDir(options),
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
        assertKnownModule(input.module, options);
        const filePath = options?.skillCatalog
          ? options.skillCatalog.updateSkill(input.name, input.description, input.content, input.module)
          : updateSkillFile(
            input.name,
            input.description,
            input.content,
            input.module,
            resolveSkillsDir(options),
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
        assertKnownModule(input.module, options);
        const fileName = options?.skillCatalog
          ? options.skillCatalog.deleteSkill(input.name, input.module)
          : deleteSkillFile(input.name, resolveSkillsDir(options));
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
    ...readTools,
    createSkillTool,
    editSkillTool,
    deleteSkillTool,
  ];
};
