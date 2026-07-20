import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  createSkillActionRegistry,
  registerSkillActions,
} from "../../src/tools/skill-actions.js";
import {
  createReadSkillTool,
  createSkillCrudTools,
} from "../../src/tools/skill-management.js";

const createTempSkillsRoot = (): string => mkdtempSync(path.join(process.cwd(), "test-skill-tools-"));

const createCrudTools = (rootDir: string) =>
  createSkillCrudTools({ skillsDir: rootDir });

describe("createReadSkillTool", () => {
  it("loads a finance skill by name", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(result).toContain("# Expenses");
    expect(result).toContain("fetch_wise_transactions");
    expect(result).not.toContain("<skill_context>");
    expect(result).not.toContain("<available_tools>");
  });

  it("lists available skills when the requested skill is missing", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "missing-skill" }));

    expect(result).toContain("Error reading skill:");
    expect(result).toContain("sync-expenses");
    expect(result).not.toContain("<skill_context>");
    expect(result).not.toContain("<available_tools>");
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
    expect(result).toContain("# Expenses");
    expect(result).toContain("<skill_context>");
    expect(result).toContain("expense_categories:");
    expect(result).toContain('"name":"Food"');
    expect(result).not.toContain("<available_tools>");
  });

  it("returns the skill plus a non-fatal action error when enrichment fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "sync-expenses", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    const result = String(await readSkill.invoke({ name: "sync-expenses" }));

    expect(result).toContain("# Expenses");
    expect(result).toContain("action_error expense_categories:");
    expect(result).toContain("database unavailable");
  });
});

describe("createSkillCrudTools", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("lists skills for a module", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const listTool = tools.find((tool) => tool.name === "list_skills");

    await createTool!.invoke({
      module: "finance",
      name: "sync-expenses",
      description: "Sync expenses",
      content: "# Sync",
    });

    const result = String(await listTool!.invoke({ module: "finance" }));
    expect(result).toContain("Module: finance");
    expect(result).toContain("Skill Name: sync-expenses");
    expect(result).toContain("Description: Sync expenses");
    expect(result).toContain("Status: Listed");
  });

  it("previews a full skill file for a module", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const previewTool = tools.find((tool) => tool.name === "preview_skill");

    await createTool!.invoke({
      module: "obsidian",
      name: "daily-note",
      description: "Create daily note",
      content: "# Daily note steps",
    });

    const result = String(await previewTool!.invoke({ module: "obsidian", name: "daily-note" }));
    expect(result).toContain('name="daily-note"');
    expect(result).toContain('module="obsidian"');
    expect(result).toContain("# Daily note steps");
  });

  it("reads a full skill file for a module", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const readTool = tools.find((tool) => tool.name === "read_skill_for_edit");

    await createTool!.invoke({
      module: "obsidian",
      name: "daily-note",
      description: "Create daily note",
      content: "# Daily note steps",
    });

    const result = String(await readTool!.invoke({ module: "obsidian", name: "daily-note" }));
    expect(result).toContain('name="daily-note"');
    expect(result).toContain('module="obsidian"');
    expect(result).toContain("# Daily note steps");
  });

  it("creates, edits, and deletes a skill", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const editTool = tools.find((tool) => tool.name === "edit_skill");
    const deleteTool = tools.find((tool) => tool.name === "delete_skill");
    const readTool = tools.find((tool) => tool.name === "read_skill_for_edit");

    const createResult = String(
      await createTool!.invoke({
        module: "configuration",
        name: "manage-cron",
        description: "Manage cron jobs",
        content: "# Cron",
      }),
    );
    expect(createResult).toContain("Created skill manage-cron");

    const editResult = String(
      await editTool!.invoke({
        module: "configuration",
        name: "manage-cron",
        description: "Manage cron and schedules",
        content: "# Updated cron",
      }),
    );
    expect(editResult).toContain("Updated skill manage-cron");

    const readResult = String(await readTool!.invoke({ module: "configuration", name: "manage-cron" }));
    expect(readResult).toContain("Manage cron and schedules");
    expect(readResult).toContain("# Updated cron");

    const deleteResult = String(
      await deleteTool!.invoke({ module: "configuration", name: "manage-cron" }),
    );
    expect(deleteResult).toContain("Deleted skill manage-cron");
    expect(() => readFileSync(path.join(tempRoot, "manage-cron.xml"), "utf8")).toThrow();
  });

  it("returns errors for duplicate create and missing delete", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const deleteTool = tools.find((tool) => tool.name === "delete_skill");

    await createTool!.invoke({
      module: "finance",
      name: "dup-skill",
      description: "First",
      content: "Body",
    });

    const duplicateResult = String(
      await createTool!.invoke({
        module: "finance",
        name: "dup-skill",
        description: "Second",
        content: "Body two",
      }),
    );
    expect(duplicateResult).toContain("Error:");
    expect(duplicateResult).toContain("already exists");

    const deleteResult = String(
      await deleteTool!.invoke({ module: "finance", name: "missing-skill" }),
    );
    expect(deleteResult).toContain("Error:");
    expect(deleteResult).toContain("not found");
  });
});
