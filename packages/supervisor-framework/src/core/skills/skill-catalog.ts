import {
  createSkillFile,
  deleteSkillFile,
  describeWritableSkillLocation,
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
} from "./catalog.js";

export type SkillCatalogOptions = {
  skillsDir?: string;
  writableSkillsDir?: string;
  approvedModules?: readonly string[];
};

export const createSkillCatalog = (
  options: SkillCatalogOptions = {},
): SkillCatalog & SkillAttachmentCatalog => {
  const skillsDir = options.skillsDir ?? SKILLS_ROOT;
  const writableSkillsDir = options.writableSkillsDir;
  const storeOptions = {
    skillsDir,
    ...(writableSkillsDir ? { writableSkillsDir } : {}),
  };
  const resolveOptions = (module?: string) => ({
    ...(module ? { module } : {}),
    ...storeOptions,
  } as const);

  const listModules = (): string[] => {
    const fromFiles = listSkillModules(storeOptions);
    const approved = options.approvedModules ?? [];

    return [...new Set([...fromFiles, ...approved])].sort();
  };

  const formatWriteLocation = (name: string, filePath: string): string =>
    writableSkillsDir ? describeWritableSkillLocation(name) : filePath;

  return {
    listSkills: (listOptions) => listSkills(resolveOptions(listOptions?.module)),

    listModules,

    readContent: (name, readOptions) =>
      readSkillContent(name, resolveOptions(readOptions?.module)),

    readFull: (name, readOptions) =>
      readFullSkill(name, resolveOptions(readOptions?.module)),

    createSkill: (name, description, body, module) =>
      formatWriteLocation(
        name,
        createSkillFile(name, description, body, module, storeOptions),
      ),

    updateSkill: (name, description, body, module) =>
      formatWriteLocation(
        name,
        updateSkillFile(name, description, body, module, storeOptions),
      ),

    deleteSkill: (name, _module) => {
      deleteSkillFile(name, storeOptions);
      return writableSkillsDir ? describeWritableSkillLocation(name) : `${name}.xml`;
    },

    formatForDisplay: (
      module: string,
      skills: SkillMeta[],
      status: SkillDisplayStatus = "Listed",
    ) => formatSkillsForDisplay(module, skills, status),

    formatForPrompt: (skills) => formatSkillsForPrompt(skills),

    loadAttachmentRules: (module) =>
      loadSkillAttachmentRules(module, storeOptions),
  };
};
