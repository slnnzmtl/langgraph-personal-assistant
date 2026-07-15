import { describe, expect, it, vi } from "vitest";

import {
  createSkillActionRegistry,
  enrichSkillWithActions,
  formatSkillContextBlock,
  registerSkillActions,
  runSkillActions,
  SKILL_CONTEXT_MAX_CHARS,
} from "../../src/tools/skill-actions.js";

describe("skill action registry", () => {
  it("returns no actions for unknown prompt keys or skills", () => {
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run: async () => "[]" },
    ]);

    expect(registry.get("obsidian")).toBeUndefined();
    expect(registry.get("finance")?.get("missing-skill")).toBeUndefined();
  });

  it("matches skill names case-insensitively", () => {
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "Sync-Expenses", [
      { label: "expense_categories", run: async () => "[]" },
    ]);

    expect(registry.get("finance")?.get("sync-expenses")).toHaveLength(1);
  });
});

describe("runSkillActions", () => {
  it("collects successful action output", async () => {
    const { results, errors } = await runSkillActions([
      { label: "expense_categories", run: async () => '[{"id":1}]' },
    ]);

    expect(results).toEqual([{ label: "expense_categories", content: '[{"id":1}]' }]);
    expect(errors).toEqual([]);
  });

  it("records action failures without throwing", async () => {
    const { results, errors } = await runSkillActions([
      {
        label: "expense_categories",
        run: async () => {
          throw new Error("database unavailable");
        },
      },
    ]);

    expect(results).toEqual([]);
    expect(errors).toEqual([{ label: "expense_categories", error: "database unavailable" }]);
  });
});

describe("formatSkillContextBlock", () => {
  it("returns undefined when there is no action output", () => {
    expect(formatSkillContextBlock([], [])).toBeUndefined();
  });

  it("formats successful and failed action sections", () => {
    const block = formatSkillContextBlock(
      [{ label: "expense_categories", content: '[{"id":1}]' }],
      [{ label: "other_action", error: "failed" }],
    );

    expect(block).toContain("<skill_context>");
    expect(block).toContain("expense_categories:");
    expect(block).toContain('[{"id":1}]');
    expect(block).toContain("action_error other_action:");
    expect(block).toContain("failed");
    expect(block).toContain("</skill_context>");
  });

  it("truncates oversized action context", () => {
    const oversized = "x".repeat(SKILL_CONTEXT_MAX_CHARS + 500);
    const block = formatSkillContextBlock([{ label: "expense_categories", content: oversized }], []);

    expect(block).toBeDefined();
    expect(block!.length).toBeLessThan(oversized.length + 50);
    expect(block).toContain("[truncated");
  });
});

describe("enrichSkillWithActions", () => {
  it("returns the original skill when no actions are registered", async () => {
    const content = await enrichSkillWithActions({
      content: "Skill body",
      promptKey: "finance",
      skillName: "sync-expenses",
    });

    expect(content).toBe("Skill body");
  });

  it("appends action context for registered skills", async () => {
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run: async () => '[{"id":1,"name":"Food"}]' },
    ]);

    const content = await enrichSkillWithActions({
      content: "Skill body",
      promptKey: "finance",
      skillName: "sync-expenses",
      actionRegistry: registry,
    });

    expect(content).toContain("Skill body");
    expect(content).toContain("<skill_context>");
    expect(content).toContain("expense_categories:");
    expect(content).toContain('"name":"Food"');
  });

  it("keeps the skill body when an action fails", async () => {
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      {
        label: "expense_categories",
        run: async () => {
          throw new Error("database unavailable");
        },
      },
    ]);

    const content = await enrichSkillWithActions({
      content: "Skill body",
      promptKey: "finance",
      skillName: "sync-expenses",
      actionRegistry: registry,
    });

    expect(content).toContain("Skill body");
    expect(content).toContain("action_error expense_categories:");
    expect(content).toContain("database unavailable");
  });
});
