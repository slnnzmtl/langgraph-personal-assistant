import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getSkillsDir } from "../prompts/load-system-prompt.js";
import { listSkills, readSkillContent } from "../prompts/skills-loader.js";
import { truncateToolOutput } from "./output.js";

export const ReadSkillToolSchema = z.object({
  name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
});

export const createReadSkillTool = (
  promptKey: string,
  fileType: "md" | "xml" = "md",
): StructuredToolInterface =>
  tool(
    async (input: z.infer<typeof ReadSkillToolSchema>) => {
      const skillsDir = getSkillsDir(promptKey, fileType);

      try {
        const content = readSkillContent(skillsDir, input.name);
        return truncateToolOutput(content);
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
