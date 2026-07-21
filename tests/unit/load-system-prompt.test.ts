import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendDynamicSections,
  createPromptLoader,
  formatObsidianRoutineHint,
  formatSystemMetadata,
  getSkillsRoot,
  injectRuntimeExecutionModel,
  loadConfigurationSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
  loadPrompt,
  loadSupervisorSystemPrompt,
  RUNTIME_EXECUTION_MODEL,
} from "../../src/prompts/load-system-prompt.js";

describe("named prompt loaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the supervisor prompt from prompts/supervisor.xml", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor");
    expect(prompt).not.toContain("<runtime_execution>");
    expect(prompt).toContain("CURRENT DATETIME:");
    expect(prompt.indexOf("You are the Root Supervisor")).toBeLessThan(
      prompt.indexOf("<system_metadata>"),
    );
  });

  it("loads the Obsidian prompt from prompts/obsidian.xml", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("Obsidian Vault Manager");
    expect(prompt).toContain("<runtime_execution>");
    expect(prompt).not.toContain("One tool call per turn");
    expect(prompt).not.toContain("CURRENT DATETIME:");
    expect(prompt).not.toContain("Yesterday: routine/");
  });

  it("loads the Finance prompt from prompts/finance.xml and includes skills listing", () => {
    const prompt = loadFinanceSystemPrompt();

    expect(prompt).toContain("Financial Assistant");
    expect(prompt).toContain("<skill_usage>");
    expect(prompt).toContain("call `read_skill` for the matching skill");
    expect(prompt).toContain("expense-view");
    expect(prompt).toContain("expense-sync");
    expect(prompt).toContain("expense-update");
    expect(prompt).toContain("call `read_skill`");
    expect(prompt).toContain("<runtime_execution>");
    expect(prompt).toContain("Never return an empty turn");
    expect(prompt).not.toContain("After every tool result, always continue");
    const skillsSection = prompt.match(/<available_skills>.*<\/available_skills>/s);
    if (skillsSection) {
      expect(prompt).toContain("expense-view");
      expect(prompt).toContain("expense-sync");
      expect(prompt).toContain("expense-update");
      expect(prompt).toContain("expense-ledger-schema");
    }
    expect(prompt).not.toContain("CURRENT DATETIME:");
  });

  it("loads the configuration prompt from prompts/configuration.xml", () => {
    const prompt = loadConfigurationSystemPrompt();

    expect(prompt).toContain("Configuration Manager");
    expect(prompt).toContain("<tool_access>");
    expect(prompt).toContain("All configuration tools are available from the start");
    expect(prompt).toContain("read_skill(skill_name)");
    expect(prompt).toContain("<output_template>");
    expect(prompt).toContain("<skill_output_template>");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toMatch(/cron|skill-management/);
    expect(prompt).toContain("<runtime_execution>");
    expect(prompt).not.toContain("CURRENT DATETIME:");
  });
});

describe("dynamic prompt formatters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatSystemMetadata includes datetime ranges and optional runtime agent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const metadata = formatSystemMetadata(new Date(), { runtimeAgent: "Obsidian" });

    expect(metadata).toContain("CURRENT DATETIME:");
    expect(metadata).toContain("TODAY");
    expect(metadata).toContain("YESTERDAY");
    expect(metadata).toContain("RUNTIME_AGENT: Obsidian");
  });

  it("formatObsidianRoutineHint includes yesterday and today paths", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const hint = formatObsidianRoutineHint(new Date());

    expect(hint).toContain("Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.");
    expect(hint).toContain("Yesterday: routine/July/July 9 - Thu.md");
    expect(hint).toContain("Today: routine/July/July 10 - Fri.md");
  });

  it("appendDynamicSections appends non-empty sections after the static prefix", () => {
    const prompt = appendDynamicSections("Static rules", "Dynamic block");

    expect(prompt).toBe("Static rules\n\nDynamic block");
    expect(prompt.indexOf("Static rules")).toBeLessThan(prompt.indexOf("Dynamic block"));
  });
});

describe("injectRuntimeExecutionModel", () => {
  it("appends the shared runtime execution block", () => {
    const prompt = injectRuntimeExecutionModel("Base prompt");

    expect(prompt).toBe(`Base prompt\n\n${RUNTIME_EXECUTION_MODEL}`);
  });
});

describe("createPromptLoader", () => {
  it("loads prompt by key and caches when hotReload is disabled", () => {
    const loadByKey = createPromptLoader("supervisor", { hotReload: false, fileType: "xml" });

    const result1 = loadByKey();
    const result2 = loadByKey();

    expect(result1).toBe(result2);
    expect(result1).toContain("You are the Root Supervisor");
  });

  it("reloads prompt content when hotReload is enabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-reload-"));
    const promptPath = path.join(tempDir, "prompt.md");

    try {
      await writeFile(promptPath, "Version 1\n", "utf8");
      const loadPromptByPath = createPromptLoader(promptPath, { hotReload: true });

      expect(loadPromptByPath()).toBe("Version 1");

      await writeFile(promptPath, "Version 2\n", "utf8");

      expect(loadPromptByPath()).toBe("Version 2");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("loadPrompt", () => {
  it("resolves prompts by file-first convention: key.xml", () => {
    const prompt = loadPrompt("supervisor", "xml");

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("resolves prompts by file-first convention with md/xml fallback", () => {
    const prompt = loadPrompt("supervisor");

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("resolves agent prompts like prompts/obsidian.xml", () => {
    const prompt = loadPrompt("obsidian", "xml");

    expect(prompt).toContain("Obsidian Vault Manager");
  });

  it("resolves skill files via skills/{skillName} key shape", () => {
    const prompt = loadPrompt("skills/expense-view");

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("<view_intent>");
  });

  it("throws when prompt key does not exist", () => {
    expect(() => loadPrompt("nonexistent")).toThrow(/Prompt not found: "nonexistent"/);
  });

  it("throws when prompt file is empty", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-empty-"));
    const promptPath = path.join(tempDir, "empty.md");

    try {
      await writeFile(promptPath, "\n", "utf8");

      expect(() => loadPrompt(promptPath)).toThrow(/System prompt file is empty/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("getSkillsRoot", () => {
  it("resolves the flat skills directory", () => {
    const skillsRoot = getSkillsRoot();

    expect(skillsRoot).toMatch(/skills[/\\]?$/);
  });
});
