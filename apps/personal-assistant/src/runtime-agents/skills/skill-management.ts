import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  listSkills,
  readSkillContent,
} from "./skills-loader.js";
import type { SkillCatalog } from "@personal-assistant/supervisor-framework";
import { enrichSkillWithActions, type SkillActionRegistry } from "./skill-actions.js";
import { truncateToolOutput } from "../tools/output.js";

export const ReadSkillToolSchema = z.object({
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export type ReadSkillToolOptions = {
  actionRegistry?: SkillActionRegistry;
  skillCatalog?: SkillCatalog;
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
