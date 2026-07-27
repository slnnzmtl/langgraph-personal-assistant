import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_AGENT_ID } from "@personal-assistant/supervisor-framework";

import {
  appendDynamicSections,
  createPromptLoader, 
  formatSystemMetadata,
  loadPrompt,
  loadSupervisorSystemPrompt,
  loadSystemPromptByKey,
  SUPERVISOR_PROMPT_KEY,
} from "../../src/prompts/load.js";
import { getRuntimeAgentFixture } from "../helpers/fakes.js";

describe("prompt loaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the supervisor prompt from agents/supervisor.xml", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor");
    expect(prompt).toContain("post_handoff_replan_rules");
    expect(prompt).not.toContain("<runtime_execution>");
    expect(prompt).toContain("CURRENT DATETIME:");
    expect(prompt.indexOf("You are the Root Supervisor")).toBeLessThan(
      prompt.indexOf("<system_metadata>"),
    );
  });

  it("loads runtime agent prompts by promptSourceKey without shell enrichment", () => {
    const obsidianPrompt = loadSystemPromptByKey(getRuntimeAgentFixture("obsidian").promptSourceKey!);
    const financePrompt = loadSystemPromptByKey(getRuntimeAgentFixture("finance").promptSourceKey!);
    const configurationPrompt = loadSystemPromptByKey(SYSTEM_AGENT_ID);

    expect(obsidianPrompt).toContain("Obsidian Vault Manager");
    expect(obsidianPrompt).not.toContain("<runtime_execution>");
    expect(obsidianPrompt).not.toContain("One tool call per turn");
    expect(obsidianPrompt).not.toContain("CURRENT DATETIME:");
    expect(obsidianPrompt).not.toContain("Yesterday: routine/");

    expect(financePrompt).toContain("Financial Assistant");
    expect(financePrompt).toContain("<skill_usage>");
    expect(financePrompt).toContain("call `read_skill` for the matching skill");
    expect(financePrompt).toContain("<tool_error_recovery>");
    expect(financePrompt).toContain("ambiguous SQL columns");
    expect(financePrompt).not.toContain("<runtime_execution>");
    expect(financePrompt).not.toContain("<available_skills>");
    expect(financePrompt).not.toContain("CURRENT DATETIME:");

    expect(configurationPrompt).toContain("Configuration Manager");
    expect(configurationPrompt).toContain("<tool_access>");
    expect(configurationPrompt).toContain("All configuration tools are available from the start");
    expect(configurationPrompt).toContain("read_skill(skill_name)");
    expect(configurationPrompt).toContain("<output_template>");
    expect(configurationPrompt).toContain("<skill_output_template>");
    expect(configurationPrompt).not.toMatch(/<available_skills>\s*\n/);
    expect(configurationPrompt).not.toContain("<runtime_execution>");
    expect(configurationPrompt).not.toContain("CURRENT DATETIME:");
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

  it("appendDynamicSections appends non-empty sections after the static prefix", () => {
    const prompt = appendDynamicSections("Static rules", "Dynamic block");

    expect(prompt).toBe("Static rules\n\nDynamic block");
    expect(prompt.indexOf("Static rules")).toBeLessThan(prompt.indexOf("Dynamic block"));
  });
});

describe("createPromptLoader", () => {
  it("loads prompt by key and caches when hotReload is disabled", () => {
    const loadByKey = createPromptLoader(SUPERVISOR_PROMPT_KEY, { hotReload: false, fileType: "xml" });

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
    const prompt = loadPrompt(SUPERVISOR_PROMPT_KEY, "xml");

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("resolves prompts by file-first convention with md/xml fallback", () => {
    const prompt = loadPrompt(SUPERVISOR_PROMPT_KEY);

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("resolves agent prompts like agents/obsidian.xml", () => {
    const prompt = loadPrompt("obsidian", "xml");

    expect(prompt).toContain("Obsidian Vault Manager");
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
