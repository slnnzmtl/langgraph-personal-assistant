import type { SkillCatalog, SkillDisplayStatus, SkillFull, SkillMeta, ListSkillsOptions } from "../../core/skills/catalog.js";

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
  createSkill: (): string => "skills disabled",
  updateSkill: (): string => "skills disabled",
  deleteSkill: (): string => "skills disabled",
  formatForDisplay: (
    _module: string,
    _skills: SkillMeta[],
    _status?: SkillDisplayStatus,
  ): string => "",
  formatForPrompt: (): string => "",
});
