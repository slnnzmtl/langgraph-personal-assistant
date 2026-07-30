import type { SkillCatalog, SkillDisplayStatus, SkillFull, SkillMeta, ListSkillsOptions } from "../../../core/skills/catalog.js";

export const createEmptySkillCatalog = (): SkillCatalog => ({
  listSkills: (_options?: ListSkillsOptions): SkillMeta[] => [],
  listModules: (): string[] => [],
  readContent: (): string => "",
  readFull: (name): SkillFull => ({
    name,
    description: "",
    body: "",
    module: "",
    fileName: "",
  }),
  createSkill: async (): Promise<string> => "skills disabled",
  updateSkill: async (): Promise<string> => "skills disabled",
  deleteSkill: async (): Promise<string> => "skills disabled",
  formatForDisplay: (
    _module: string,
    _skills: SkillMeta[],
    _status?: SkillDisplayStatus,
  ): string => "",
  formatForPrompt: (): string => "",
});
