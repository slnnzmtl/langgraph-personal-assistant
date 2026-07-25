import { describe, expect, it } from "vitest";

import {
  formatConfigurationSkillCatalog,
  isConfigurationSkillCatalogRequest,
  isSkillListDisplayIntent,
  isSkillMutatingIntent,
  isSkillPreviewDisplayIntent,
  shouldShortCircuitReadOnlySkillTool,
} from "../../../src/app/policies/configuration-hooks.js";
import { createSkillCatalog } from "../../../src/runtime-agents/skills/skill-catalog.js";
import { CONFIGURATOR_AGENT_ID } from "../../../src/app/composition/bootstrap-agents.js";

const skillCatalog = createSkillCatalog({
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

describe("read-only skill tool short-circuit intents", () => {
  it("detects mutating skill intents", () => {
    expect(isSkillMutatingIntent("Create a new skill named finance-summary for the finance agent.")).toBe(true);
    expect(isSkillMutatingIntent("create a skill for finance agent\nname: finance-summary")).toBe(true);
    expect(isSkillMutatingIntent("edit sync-expenses skill")).toBe(true);
  });

  it("detects list display intents", () => {
    expect(isSkillListDisplayIntent("list skills")).toBe(true);
    expect(isSkillListDisplayIntent("list finance skills")).toBe(true);
    expect(isSkillListDisplayIntent("Create a new skill named finance-summary")).toBe(false);
  });

  it("detects preview display intents", () => {
    expect(isSkillPreviewDisplayIntent("preview sync-expenses skill")).toBe(true);
    expect(isSkillPreviewDisplayIntent("read the expense-sync skill")).toBe(true);
    expect(isSkillPreviewDisplayIntent("Create a new skill named finance-summary")).toBe(false);
  });

  it("only short-circuits read-only tools for display intents", () => {
    expect(shouldShortCircuitReadOnlySkillTool("list_skills", "list skills")).toBe(true);
    expect(shouldShortCircuitReadOnlySkillTool("preview_skill", "read sync-expenses")).toBe(true);
    expect(shouldShortCircuitReadOnlySkillTool(
      "list_skills",
      "Create a new skill named finance-summary for the finance agent.",
    )).toBe(false);
    expect(shouldShortCircuitReadOnlySkillTool(
      "preview_skill",
      "create a skill for finance agent\nname: finance-summary",
    )).toBe(false);
  });
});
