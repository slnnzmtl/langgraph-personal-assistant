import { describe, expect, it } from "vitest";

import {
  createSkillCatalog,
  resolveAgentSkillModule,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { createDefaultRuntimeShellFormatters } from "../../../src/composition/runtime-execution.js";
import { loadSystemPromptByKey } from "../../../src/prompts/load.js";

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

describe("runtime shell prompt enrichment", () => {
  const skillCatalog = createSkillCatalog({
    approvedModules: ["finance", "obsidian", "configuration"],
  });

  it("createDefaultRuntimeShellFormatters enriches runtime agent prompts at shell time", () => {
    const formatters = createDefaultRuntimeShellFormatters(skillCatalog);
    const basePrompt = loadSystemPromptByKey(
      resolveAgentSkillModule({
        ...financeDefinition,
        id: "obsidian",
        name: "Obsidian",
        promptSourceKey: "obsidian",
      }),
    );

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
