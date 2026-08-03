import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildCachedRuntimePromptMessages,
  buildRuntimePromptParts,
  buildStaticRuntimePrompt,
  buildTurnContextMessage,
} from "../../../src/framework/system-agent/cache-prompt.js";
import { RUNTIME_EXECUTION_MODEL } from "../../../src/core/skills/prompt-enrichment.js";
import { createSkillCatalog } from "../../../src/core/skills/skill-catalog.js";
import type { RuntimeAgentDefinition } from "../../../src/core/types/agent.js";
import { APP_SKILLS_DIR } from "../../helpers/app-skills-dir.js";

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

const financeDefinition: RuntimeAgentDefinition = {
  id: "finance",
  name: "Finance",
  description: "Finance agent",
  systemPrompt: "Base finance prompt",
  promptSourceKey: "finance",
  capabilityIds: ["finance-domain"],
  modelKey: "finance",
  maxSteps: 10,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("runtime cache prompt helpers", () => {
  const skillCatalog = createSkillCatalog({
    skillsDir: APP_SKILLS_DIR,
    approvedModules: ["configuration", "finance", "obsidian"],
  });

  it("buildStaticRuntimePrompt includes runtime execution guidance", () => {
    const prompt = buildStaticRuntimePrompt("Base configuration prompt");

    expect(prompt).toContain("Base configuration prompt");
    expect(prompt).toContain(RUNTIME_EXECUTION_MODEL);
    expect(prompt).not.toContain("<skill_usage>");
  });

  it("buildRuntimePromptParts puts skills and metadata in dynamic turn context", () => {
    const parts = buildRuntimePromptParts(
      "Base configuration prompt",
      configurationDefinition,
      [new HumanMessage("list skills")],
      skillCatalog,
      "<system_metadata>\nCURRENT DATETIME: test\n</system_metadata>",
      ["Vault directory tree (folders only):\n- notes"],
    );

    expect(parts.staticPrompt).toContain(RUNTIME_EXECUTION_MODEL);
    expect(parts.staticPrompt).not.toContain("<skill_usage>");
    expect(parts.dynamicPrompt).not.toContain("<skill_usage>");
    expect(parts.dynamicPrompt).toContain("<available_skills>");
    expect(parts.dynamicPrompt).toContain("<system_metadata>");
    expect(parts.dynamicPrompt).toContain("Vault directory tree");
    expect(parts.staticPrompt).not.toContain("Vault directory tree");
  });

  it("buildRuntimePromptParts attaches matching skills into dynamic turn context", () => {
    const parts = buildRuntimePromptParts(
      "Base configuration prompt",
      configurationDefinition,
      [new HumanMessage("Create a new skill for the finance agent named finance-summary.")],
      skillCatalog,
      "<system_metadata>\nCURRENT DATETIME: test\n</system_metadata>",
    );

    expect(parts.dynamicPrompt).toContain("<attached_skills>");
    expect(parts.dynamicPrompt).toContain('<attached_skill name="skill-bootstrap">');
    expect(parts.staticPrompt).not.toContain("<attached_skills>");
  });

  it("buildRuntimePromptParts omits attachment bodies after a tool result", () => {
    const parts = buildRuntimePromptParts(
      "Base finance prompt",
      financeDefinition,
      [
        new HumanMessage("Show last expenses"),
        new AIMessage({
          content: "",
          tool_calls: [{ id: "1", name: "exec_sql", args: { sql: "SELECT 1" } }],
        }),
        new ToolMessage({
          tool_call_id: "1",
          name: "exec_sql",
          content: '[{"id":1}]',
        }),
      ],
      skillCatalog,
      "<system_metadata>\nCURRENT DATETIME: test\n</system_metadata>",
    );

    expect(parts.dynamicPrompt).toContain("<available_skills>");
    expect(parts.dynamicPrompt).toContain("<system_metadata>");
    expect(parts.dynamicPrompt).not.toContain("<attached_skills>");
    expect(parts.dynamicPrompt).not.toContain("call `exec_sql` now");
  });

  // Stitch behavior is covered in cache-prompt-messages.test.ts; smoke the re-export.
  it("re-exports buildCachedRuntimePromptMessages", () => {
    const messages = buildCachedRuntimePromptMessages(
      "<system_metadata>test</system_metadata>",
      [new HumanMessage("restore the skill")],
    );

    expect(messages).toHaveLength(1);
    expect(String(messages[0]?.content)).toContain("<turn_context>");
    expect(String(messages[0]?.content)).toContain("restore the skill");
  });

  it("buildTurnContextMessage returns null for empty dynamic context", () => {
    expect(buildTurnContextMessage("   ")).toBeNull();
  });
});
