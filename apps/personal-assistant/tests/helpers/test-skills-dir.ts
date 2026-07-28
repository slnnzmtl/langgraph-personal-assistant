import path from "node:path";

import { createSkillCatalog, type SkillCatalog } from "@personal-assistant/supervisor-framework";

/** Product skill XML files under the app data volume (same path as production). */
export const TEST_SKILLS_DIR = path.resolve(process.cwd(), "data/skills");

export const DEFAULT_TEST_SKILL_MODULES = ["finance", "obsidian", "configuration"] as const;

export const createTestSkillCatalog = (
  approvedModules: readonly string[] = DEFAULT_TEST_SKILL_MODULES,
): SkillCatalog =>
  createSkillCatalog({
    skillsDir: TEST_SKILLS_DIR,
    approvedModules: [...approvedModules],
  });
