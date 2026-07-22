import {
  createSkillFile,
  deleteSkillFile,
  formatSkillForDisplay,
  formatSkillsForDisplay,
  formatSkillsForPrompt,
  listSkillModules,
  listSkills,
  loadSkillAttachmentRules,
  readFullSkill,
  readSkillContent,
  serializeSkillFile,
  SKILLS_ROOT,
  updateSkillFile,
} from "../../prompts/skills-loader.js";
import type {
  ListSkillsOptions,
  SkillAttachmentCatalog,
  SkillCatalog,
  SkillDisplayStatus,
  SkillMeta,
} from "@personal-assistant/supervisor-framework";

export type FilesystemSkillCatalogOptions = {
  skillsDir?: string;
  approvedModules?: readonly string[];
};

export const createFilesystemSkillCatalog = (
  options: FilesystemSkillCatalogOptions = {},
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

export const formatSkillPreview = (
  catalog: SkillCatalog,
  module: string,
  name: string,
): string => {
  const skill = catalog.readFull(name, { module });
  return serializeSkillFile(
    { name: skill.name, description: skill.description, module: skill.module ?? module },
    skill.body,
    skill.fileName,
  );
};

export { formatSkillForDisplay };
