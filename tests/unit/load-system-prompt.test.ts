import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPromptLoader,
  loadConfiguratorSystemPrompt,
  loadFinanceSystemPrompt,
  loadObsidianSystemPrompt,
  loadSupervisorSystemPrompt,
  loadSystemPromptMarkdown,
} from "../../src/prompts/load-system-prompt.js";

describe("named prompt loaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the supervisor prompt from prompts/supervisor.md", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor");
  });

  it("loads the Obsidian prompt from prompts/obsidian.md", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("# Role & Objective");
  });

  it("loads the Finance prompt from prompts/finance/system.md and includes skills listing", () => {
    const prompt = loadFinanceSystemPrompt();

    expect(prompt).toContain("Financial Assistant & Sync Agent");
    // Check for skills section if any skills exist
    const skillsSection = prompt.match(/<available_skills>.*<\/available_skills>/s);
    if (skillsSection) {
      expect(prompt).toContain("sync-expenses");
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

  it("loads the configurator prompt from prompts/configurator.md", () => {
    const prompt = loadConfiguratorSystemPrompt();

    expect(prompt).toContain("When the user asks to schedule a daily note");
    expect(prompt).toContain("in 5 minutes");
    expect(prompt).toContain("If the user asks to list, show, view, or inspect existing cron jobs, call `list_cron_jobs` only");
  });
});

describe("createPromptLoader", () => {
  it("reloads prompt content when hotReload is enabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-reload-"));
    const promptPath = path.join(tempDir, "prompt.md");

    try {
      await writeFile(promptPath, "Version 1\n", "utf8");
      const loadPrompt = createPromptLoader(promptPath, { hotReload: true });

      expect(loadPrompt()).toBe("Version 1");

      await writeFile(promptPath, "Version 2\n", "utf8");

      expect(loadPrompt()).toBe("Version 2");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("loadSystemPromptMarkdown", () => {
  it("reads prompt markdown from disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-"));
    const promptPath = path.join(tempDir, "system-prompt.md");

    try {
      await writeFile(promptPath, "Prompt from disk\n", "utf8");

      expect(loadSystemPromptMarkdown(promptPath)).toBe("Prompt from disk");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when the prompt file is empty", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-empty-"));
    const promptPath = path.join(tempDir, "system-prompt.md");

    try {
      await writeFile(promptPath, "\n", "utf8");

      expect(() => loadSystemPromptMarkdown(promptPath)).toThrow(
        `System prompt file is empty: ${promptPath}`,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("mirrors prompt logs to stdout when enabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-log-"));
    const promptPath = path.join(tempDir, "system-prompt.md");
    const logFilePath = path.join(process.cwd(), "logs", "prompt-log-test.txt");

    try {
      await writeFile(promptPath, "Prompt logging test\n", "utf8");
      vi.stubEnv("ENABLE_PROMPT_LOGS", "true");

      const { logSystemPromptInvocation } = await import("../../src/logging/system-prompt-logger.js");
      await logSystemPromptInvocation("prompt-log-test", [
        { _getType: () => "system", content: "Prompt logging test" } as never,
      ]);

      const loggedContent = await readFile(logFilePath, "utf8");
      expect(loggedContent).toContain("Prompt logging test");
    } finally {
      await rm(logFilePath, { force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});