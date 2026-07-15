import { describe, expect, it, vi } from "vitest";

import {
  createSkillActionRegistry,
  registerSkillActions,
} from "../../src/tools/skill-actions.js";
import { createReadSkillTool } from "../../src/tools/read-skill.js";

describe("createReadSkillTool", () => {
  it("loads a finance skill by name", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("fetch_wise_transactions");
    expect(result).not.toContain("<skill_context>");
  });

  it("lists available skills when the requested skill is missing", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "missing-skill" }));

    expect(result).toContain("Error reading skill:");
    expect(result).toContain("sync-expenses");
    expect(result).not.toContain("<skill_context>");
  });

  it("exposes the shared read_skill tool name", () => {
    const readSkill = createReadSkillTool("obsidian", "xml");

    expect(readSkill.name).toBe("read_skill");
  });

  it("does not run actions when the skill read fails", async () => {
    const run = vi.fn().mockResolvedValue("[]");
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    await readSkill.invoke({ name: "missing-skill" });

    expect(run).not.toHaveBeenCalled();
  });

  it("attaches registered action context after a successful skill read", async () => {
    const run = vi.fn().mockResolvedValue('[{"id":1,"name":"Food"}]');
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("<skill_context>");
    expect(result).toContain("expense_categories:");
    expect(result).toContain('"name":"Food"');
  });

  it("returns the skill plus a non-fatal action error when enrichment fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("action_error expense_categories:");
    expect(result).toContain("database unavailable");
  });
});
