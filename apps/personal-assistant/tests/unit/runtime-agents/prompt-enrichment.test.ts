import { describe, expect, it } from "vitest";

import {
  resolveAgentSkillModule,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { createDefaultRuntimeShellFormatters } from "../../../src/app/register-defaults.js";
import { loadFinanceSystemPrompt, loadObsidianSystemPrompt } from "../../../src/agents/load-system-prompt.js";
import { createSkillCatalog } from "../../../src/runtime-agents/skills/skill-catalog.js";
import {
  appendAvailableSkills,
  appendRuntimeExecutionModel,
  enrichRuntimeAgentPrompt,
  RUNTIME_EXECUTION_MODEL,
} from "../../../src/runtime-agents/skills/prompt-enrichment.js";

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
  builtin: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("prompt enrichment", () => {
  const skillCatalog = createSkillCatalog({
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
    const prompt = enrichRuntimeAgentPrompt(loadFinanceSystemPrompt(), financeDefinition, skillCatalog);

    expect(prompt).toContain("Financial Assistant");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<runtime_execution>");
    expect(prompt).toContain("Never return an empty turn");
  });

  it("createDefaultRuntimeShellFormatters enriches runtime agent prompts at shell time", () => {
    const formatters = createDefaultRuntimeShellFormatters(skillCatalog);
    const basePrompt = loadObsidianSystemPrompt();

    const enriched = formatters.appendSkillAttachments?.(
      basePrompt,
      {
        ...financeDefinition,
        id: "obsidian",
        name: "Obsidian",
        promptSourceKey: "obsidian",
      },
      [],
    );

    expect(enriched).toContain("Obsidian Vault Manager");
    expect(enriched).toContain("<available_skills>");
    expect(enriched).toContain("<runtime_execution>");
    expect(resolveAgentSkillModule(financeDefinition)).toBe("finance");
  });
});
