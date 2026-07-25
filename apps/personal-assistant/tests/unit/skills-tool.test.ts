import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { createSkillCrudTools } from "@personal-assistant/supervisor-framework";
import {
  createSkillActionRegistry,
  registerSkillActions,
} from "../../src/tools/skill-actions.js";
import { createReadSkillTool } from "../../src/tools/skill-management.js";
import { createSkillCatalog } from "../../src/runtime-agents/skills/skill-catalog.js";

const createTempSkillsRoot = (): string => mkdtempSync(path.join(process.cwd(), "test-skill-tools-"));

const createCrudTools = (rootDir: string) =>
  createSkillCrudTools({
    skillCatalog: createSkillCatalog({
      skillsDir: rootDir,
      approvedModules: ["finance", "obsidian", "configuration"],
    }),
  });

describe("createReadSkillTool", () => {
  it("loads a finance skill by name", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "expense-view" }));

    expect(result).toContain("<view_intent>");
    expect(result).toContain("<latest_expenses_with_categories>");
    expect(result).toContain("LEFT JOIN public.category AS c ON e.category = c.id");
    expect(result).toContain("ORDER BY e.paid_date DESC, e.id DESC");
    expect(result).not.toContain("<skill_context>");
    expect(result).not.toContain("<available_tools>");
  });

  it("includes canonical aliased verification SQL in expense-update", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "expense-update" }));

    expect(result).toContain("<verification_query>");
    expect(result).toContain("e.id");
    expect(result).toContain("c.name AS category_name");
    expect(result).toContain("qualify every selected column");
  });

  it("lists available skills when the requested skill is missing", async () => {
    const readSkill = createReadSkillTool("finance", "xml");
    const result = String(await readSkill.invoke({ name: "missing-skill" }));

    expect(result).toContain("Error reading skill:");
    expect(result).toContain("expense-view");
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
    registerSkillActions(registry, "finance", "expense-view", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    await readSkill.invoke({ name: "missing-skill" });

    expect(run).not.toHaveBeenCalled();
  });

  it("attaches registered action context after a successful skill read", async () => {
    const run = vi.fn().mockResolvedValue('[{"id":1,"name":"Food"}]');
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "expense-view", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    const result = String(await readSkill.invoke({ name: "expense-view" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toContain("<view_intent>");
    expect(result).toContain("<skill_context>");
    expect(result).toContain("expense_categories:");
    expect(result).toContain('"name":"Food"');
    expect(result).not.toContain("<available_tools>");
  });

  it("returns the skill plus a non-fatal action error when enrichment fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const registry = createSkillActionRegistry();
    registerSkillActions(registry, "finance", "expense-view", [
      { label: "expense_categories", run },
    ]);

    const readSkill = createReadSkillTool("finance", "xml", { actionRegistry: registry });
    const result = String(await readSkill.invoke({ name: "expense-view" }));

    expect(result).toContain("<view_intent>");
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
      name: "expense-view",
      description: "Sync expenses",
      content: "# Sync",
    });

    const result = String(await listTool!.invoke({ module: "finance" }));
    expect(result).toContain("Module: finance");
    expect(result).toContain("Skill Name: expense-view");
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
    expect(result).toContain("Name: daily-note");
    expect(result).toContain("Module: obsidian");
    expect(result).toContain("# Daily note steps");
  });

  it("loads a full skill file before edit", async () => {
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
    expect(result).toContain("Name: daily-note");
    expect(result).toContain("Module: obsidian");
    expect(result).toContain("# Daily note steps");
  });

  it("creates, edits, and deletes a skill", async () => {
    tempRoot = createTempSkillsRoot();
    const tools = createCrudTools(tempRoot);
    const createTool = tools.find((tool) => tool.name === "create_skill");
    const editTool = tools.find((tool) => tool.name === "edit_skill");
    const deleteTool = tools.find((tool) => tool.name === "delete_skill");
    const previewTool = tools.find((tool) => tool.name === "preview_skill");

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

    const readResult = String(await previewTool!.invoke({ module: "configuration", name: "manage-cron" }));
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
