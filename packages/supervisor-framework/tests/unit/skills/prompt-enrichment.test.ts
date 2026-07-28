import { describe, expect, it } from "vitest";

import {
  createSkillCatalog,
  enrichRuntimeAgentPrompt,
  appendAvailableSkills,
  appendRuntimeExecutionModel,
  RUNTIME_EXECUTION_MODEL,
  resolveAgentSkillModule,
  type RuntimeAgentDefinition,
} from "../../../src/index.js";
import { APP_SKILLS_DIR } from "../../helpers/app-skills-dir.js";

const financeDefinition: RuntimeAgentDefinition = {
  id: "finance",
  name: "Finance",
  description: "Finance agent",
  systemPrompt: "",
  promptSourceKey: "finance",
  capabilityIds: ["finance-domain"],
  modelKey: "finance",
  maxSteps: 10,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("prompt enrichment", () => {
  const skillCatalog = createSkillCatalog({
    skillsDir: APP_SKILLS_DIR,
    approvedModules: ["finance", "obsidian", "configuration"],
  });

  it("appendAvailableSkills adds available_skills and read_skill hint", () => {
    const prompt = appendAvailableSkills("Base prompt", "finance", skillCatalog);

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("expense-view");
    expect(prompt).toContain("Call read_skill(skill_name)");
  });

  it("appendRuntimeExecutionModel appends the shared runtime execution block", () => {
    const prompt = appendRuntimeExecutionModel("Base prompt");

    expect(prompt).toBe(`Base prompt\n\n${RUNTIME_EXECUTION_MODEL}`);
  });

  it("enrichRuntimeAgentPrompt adds skills and runtime execution for skill modules", () => {
    const prompt = enrichRuntimeAgentPrompt(
      "Financial Assistant base prompt",
      financeDefinition,
      [],
      skillCatalog,
    );

    expect(prompt).toContain("Financial Assistant base prompt");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<runtime_execution>");
    expect(prompt).toContain("Never return an empty turn");
    expect(resolveAgentSkillModule(financeDefinition)).toBe("finance");
  });
});
