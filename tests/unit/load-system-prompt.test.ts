import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPromptLoader,
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

    expect(prompt).toContain("# Role & Core Objective");
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-prompt-log-"));
    const promptPath = path.join(tempDir, "system-prompt.md");

    try {
      await writeFile(promptPath, "Prompt logging test\n", "utf8");
      vi.stubEnv("ENABLE_PROMPT_LOGS", "true");

      const { logSystemPromptInvocation } = await import("../../src/logging/system-prompt-logger.js");
      await logSystemPromptInvocation("prompt-log-test", [
        { _getType: () => "system", content: "Prompt logging test" } as never,
      ]);

      expect(logSpy).toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});