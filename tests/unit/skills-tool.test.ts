import { describe, expect, it } from "vitest";

import { createReadSkillTool } from "../../src/tools/read-skill.js";

describe("createReadSkillTool", () => {
  it("loads a finance skill by name", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("fetch_wise_transactions");
  });

  it("lists available skills when the requested skill is missing", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "missing-skill" }));

    expect(result).toContain("Error reading skill:");
    expect(result).toContain("sync-expenses");
  });

  it("exposes the shared read_skill tool name", () => {
    const readSkill = createReadSkillTool("obsidian", "xml");

    expect(readSkill.name).toBe("read_skill");
  });
});
