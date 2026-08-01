import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildCachedRuntimePromptMessages,
  buildRuntimePromptParts,
  buildStaticRuntimePrompt,
  buildTurnContextMessage,
} from "../../../src/framework/system-agent/cache-prompt.js";
import {
  RUNTIME_EXECUTION_MODEL,
  SKILL_USAGE_GUIDE,
} from "../../../src/core/skills/prompt-enrichment.js";
import { createSkillCatalog } from "../../../src/core/skills/skill-catalog.js";
import type { RuntimeAgentDefinition } from "../../../src/core/types/agent.js";

const configurationDefinition: RuntimeAgentDefinition = {
  id: "configuration",
  name: "Configuration",
  description: "Configuration agent",
  systemPrompt: "Base configuration prompt",
  promptSourceKey: "configuration",
  capabilityIds: ["system-config"],
  modelKey: "configuration",
  maxSteps: 10,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("runtime cache prompt helpers", () => {
  const skillCatalog = createSkillCatalog({
    approvedModules: ["configuration", "finance", "obsidian"],
  });

  it("buildStaticRuntimePrompt includes runtime execution guidance", () => {
    const prompt = buildStaticRuntimePrompt("Base configuration prompt");

    expect(prompt).toContain("Base configuration prompt");
    expect(prompt).toContain(RUNTIME_EXECUTION_MODEL);
    expect(prompt).not.toContain(SKILL_USAGE_GUIDE);
  });

  it("buildRuntimePromptParts puts skill usage in dynamic turn context", () => {
    const parts = buildRuntimePromptParts(
      "Base configuration prompt",
      configurationDefinition,
      [new HumanMessage("list skills")],
      skillCatalog,
      "<system_metadata>\nCURRENT DATETIME: test\n</system_metadata>",
      ["Vault directory tree (folders only):\n- notes"],
    );

    expect(parts.staticPrompt).toContain(RUNTIME_EXECUTION_MODEL);
    expect(parts.staticPrompt).not.toContain(SKILL_USAGE_GUIDE);
    expect(parts.dynamicPrompt).toContain(SKILL_USAGE_GUIDE);
    expect(parts.dynamicPrompt).toContain("<available_skills>");
    expect(parts.dynamicPrompt).toContain("<system_metadata>");
    expect(parts.dynamicPrompt).toContain("Vault directory tree");
    expect(parts.staticPrompt).not.toContain("Vault directory tree");
  });

  it("buildCachedRuntimePromptMessages injects turn_context before conversation", () => {
    const messages = buildCachedRuntimePromptMessages(
      "<system_metadata>test</system_metadata>",
      [new HumanMessage("restore the skill")],
    );

    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(String(messages[0]?.content)).toContain("<turn_context>");
    expect(messages[1]).toBeInstanceOf(HumanMessage);
  });

  it("buildTurnContextMessage returns null for empty dynamic context", () => {
    expect(buildTurnContextMessage("   ")).toBeNull();
  });
});
