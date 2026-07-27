import { z } from "zod";

export type SkillDisplayStatus = "Created" | "Updated" | "Deleted" | "Listed" | "Previewed" | "Read";

export type SkillSource = "shipped" | "data";

export type SkillMeta = {
  name: string;
  description: string;
  module?: string;
  fileName: string;
  source?: SkillSource;
};

export type SkillFull = SkillMeta & {
  body: string;
};

export type ListSkillsOptions = {
  module?: string;
  skillsDir?: string;
  writableSkillsDir?: string;
};

export type SkillStoreOptions = Pick<ListSkillsOptions, "skillsDir" | "writableSkillsDir">;

export const SkillAttachmentMatchSchema = z.object({
  anyPhrases: z.array(z.string().min(1)).optional(),
  allPhrases: z.array(z.string().min(1)).optional(),
});

export type SkillAttachmentMatch = z.infer<typeof SkillAttachmentMatchSchema>;

export const SkillAttachmentRuleSchema = z.object({
  module: z.string().min(1),
  skillName: z.string().min(1),
  cronJobName: z.string().min(1).optional(),
  match: SkillAttachmentMatchSchema.optional(),
});

export type SkillAttachmentRule = z.infer<typeof SkillAttachmentRuleSchema>;

export type SkillCatalog = {
  listSkills(options?: ListSkillsOptions): SkillMeta[];
  listModules(): string[];
  readContent(name: string, options?: ListSkillsOptions): string;
  readFull(name: string, options?: ListSkillsOptions): SkillFull;
  createSkill(
    name: string,
    description: string,
    body: string,
    module: string,
  ): string;
  updateSkill(
    name: string,
    description: string,
    body: string,
    module: string,
  ): string;
  deleteSkill(name: string, module: string): string;
  formatForDisplay(
    module: string,
    skills: SkillMeta[],
    status?: SkillDisplayStatus,
  ): string;
  formatForPrompt(skills: SkillMeta[]): string;
};

export type SkillAttachmentCatalog = {
  loadAttachmentRules(module: string): SkillAttachmentRule[];
};
