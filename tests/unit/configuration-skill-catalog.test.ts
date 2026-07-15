import { describe, expect, it } from "vitest";

import {
  formatConfigurationSkillCatalog,
  isConfigurationSkillCatalogRequest,
} from "../../src/nodes/configuration/config-node.js";

describe("isConfigurationSkillCatalogRequest", () => {
  it("matches requests for this agent's skill catalog", () => {
    expect(isConfigurationSkillCatalogRequest("list available skills")).toBe(true);
    expect(isConfigurationSkillCatalogRequest("what skills do you have")).toBe(true);
    expect(isConfigurationSkillCatalogRequest("show skills")).toBe(true);
  });

  it("does not match cross-owner skill listing", () => {
    expect(isConfigurationSkillCatalogRequest("list finance skills")).toBe(false);
    expect(isConfigurationSkillCatalogRequest("list skills for obsidian")).toBe(false);
  });

  it("does not match cron listing", () => {
    expect(isConfigurationSkillCatalogRequest("list cron jobs")).toBe(false);
  });
});

describe("formatConfigurationSkillCatalog", () => {
  it("formats configuration skills using the skill_output_template", () => {
    const catalog = formatConfigurationSkillCatalog();

    expect(catalog).toContain("Owner: configuration");
    expect(catalog).toContain("Skill Name: cron");
    expect(catalog).toContain("Skill Name: skill-management");
    expect(catalog).toContain("Status: Listed");
  });
});
