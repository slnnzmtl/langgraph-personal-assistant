export type SkillDisplayStatus = "Created" | "Updated" | "Deleted" | "Listed" | "Previewed" | "Read";

export type SkillMeta = {
  name: string;
  description: string;
  module?: string;
  fileName: string;
};

export type SkillFull = SkillMeta & {
  body: string;
};

export type ListSkillsOptions = {
  module?: string;
};

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

export type SkillAttachmentRule = {
  module: string;
  skillName: string;
  cronJobName?: string;
  match?: {
    anyPhrases?: string[];
    allPhrases?: string[];
  };
};

export type SkillAttachmentCatalog = {
  loadAttachmentRules(module: string): SkillAttachmentRule[];
};
