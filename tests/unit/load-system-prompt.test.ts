import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPromptLoader,
  getSkillsDir,
  loadConfigurationSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
  loadPrompt,
  loadSupervisorSystemPrompt,
} from "../../src/prompts/load-system-prompt.js";

describe("named prompt loaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the supervisor prompt from prompts/supervisor.xml", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("loads the Obsidian prompt from prompts/obsidian.xml", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("Obsidian Vault Manager");
  });

  it("loads the Finance prompt from prompts/finance.xml and includes skills listing", () => {
    const prompt = loadFinanceSystemPrompt();

    expect(prompt).toContain("Financial Assistant");
    expect(prompt).toContain("<skill_usage>");
    expect(prompt).toContain('read_skill("sync-expenses")');
    expect(prompt).toContain("MUST call");
    expect(prompt).toContain("Never return an empty message");
    const skillsSection = prompt.match(/<available_skills>.*<\/available_skills>/s);
    if (skillsSection) {
      expect(prompt).toContain("sync-expenses");
      expect(prompt).toContain("View, summarize, and sync");
    }
  });

  it("includes yesterday and today routine note paths in the Obsidian prompt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    try {
      const prompt = loadObsidianSystemPrompt();

      expect(prompt).toContain("Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.");
      expect(prompt).toContain("Yesterday: routine/July/July 9 - Thu.md");
      expect(prompt).toContain("Today: routine/July/July 10 - Fri.md");
    } finally {
      vi.useRealTimers();
    }
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

  it("resolves skill files via legacy key shape finance/skills/sync-expenses", () => {
    const prompt = loadPrompt("finance/skills/sync-expenses");

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("sync-expenses");
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

describe("getSkillsDir", () => {
  it("resolves skills from skills/{agent} instead of prompts/{agent}/skills", () => {
    const skillsDir = getSkillsDir("finance", "xml");

    expect(skillsDir).toMatch(/skills[/\\]finance$/);
  });
});
