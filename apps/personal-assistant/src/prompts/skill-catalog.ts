import {
  createSkillFile,
  deleteSkillFile,
  formatSkillsForDisplay,
  formatSkillsForPrompt,
  listSkillModules,
  listSkills,
  loadSkillAttachmentRules,
  readFullSkill,
  readSkillContent,
  SKILLS_ROOT,
  updateSkillFile,
} from "./skills-loader.js";
import type {
  SkillAttachmentCatalog,
  SkillCatalog,
  SkillDisplayStatus,
  SkillMeta,
} from "@personal-assistant/supervisor-framework";

export type SkillCatalogOptions = {
  skillsDir?: string;
  approvedModules?: readonly string[];
};

export const createSkillCatalog = (
  options: SkillCatalogOptions = {},
): SkillCatalog & SkillAttachmentCatalog => {
  const skillsDir = options.skillsDir ?? SKILLS_ROOT;
  const resolveOptions = (module?: string) => ({
    ...(module ? { module } : {}),
    skillsDir,
  } as const);

  const listModules = (): string[] => {
    const fromFiles = listSkillModules({ skillsDir });
    const approved = options.approvedModules ?? [];

    return [...new Set([...fromFiles, ...approved])].sort();
  };

  return {
    listSkills: (listOptions) => listSkills(resolveOptions(listOptions?.module)),

    listModules,

    readContent: (name, readOptions) =>
      readSkillContent(name, resolveOptions(readOptions?.module)),

    readFull: (name, readOptions) =>
      readFullSkill(name, resolveOptions(readOptions?.module)),

    createSkill: (name, description, body, module) =>
      createSkillFile(name, description, body, module, skillsDir),

    updateSkill: (name, description, body, module) =>
      updateSkillFile(name, description, body, module, skillsDir),

    deleteSkill: (name, _module) => deleteSkillFile(name, skillsDir),

    formatForDisplay: (
      module: string,
      skills: SkillMeta[],
      status: SkillDisplayStatus = "Listed",
    ) => formatSkillsForDisplay(module, skills, status),

    formatForPrompt: (skills) => formatSkillsForPrompt(skills),

    loadAttachmentRules: (module) =>
      loadSkillAttachmentRules(module, skillsDir),
  };
};
