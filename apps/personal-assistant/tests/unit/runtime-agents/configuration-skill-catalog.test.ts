import { describe, expect, it } from "vitest";

import {
  formatConfigurationSkillCatalog,
  isConfigurationSkillCatalogRequest,
} from "../../../src/app/policies/configuration-hooks.js";
import { createFilesystemSkillCatalog } from "../../../src/integrations/skills/filesystem-skill-catalog.js";
import { CONFIGURATOR_AGENT_ID } from "../../../src/app/composition/bootstrap-agents.js";

const skillCatalog = createFilesystemSkillCatalog({
  approvedModules: [CONFIGURATOR_AGENT_ID, "finance", "obsidian"],
});
const skillModules = skillCatalog.listModules();

describe("isConfigurationSkillCatalogRequest", () => {
  it("matches requests for this agent's skill catalog", () => {
    expect(isConfigurationSkillCatalogRequest("list available skills", skillModules)).toBe(true);
    expect(isConfigurationSkillCatalogRequest("what skills do you have", skillModules)).toBe(true);
    expect(isConfigurationSkillCatalogRequest("show skills", skillModules)).toBe(true);
  });

  it("does not match cross-owner skill listing", () => {
    expect(isConfigurationSkillCatalogRequest("list finance skills", skillModules)).toBe(false);
    expect(isConfigurationSkillCatalogRequest("list skills for obsidian", skillModules)).toBe(false);
  });

  it("does not match cron listing", () => {
    expect(isConfigurationSkillCatalogRequest("list cron jobs", skillModules)).toBe(false);
  });
});

describe("formatConfigurationSkillCatalog", () => {
  it("formats configuration skills using the skill_output_template", () => {
    const catalog = formatConfigurationSkillCatalog(skillCatalog);

    expect(catalog).toContain("Module: configuration");
    expect(catalog).toContain("Skill Name: cron");
    expect(catalog).toContain("Skill Name: skill-management");
    expect(catalog).toContain("Status: Listed");
  });
});
