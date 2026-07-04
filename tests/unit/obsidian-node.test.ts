import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyMarkdownWrite,
  createObsidianNode,
  resolveVaultPath,
} from "../../src/nodes/obsidian-node.js";
import {
  createPromptLoader,
  loadObsidianSystemPrompt,
} from "../../src/prompts/load-system-prompt.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (tempPath) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(tempPath, { recursive: true, force: true }),
      );
    }),
  );
});

const createTempVault = async (): Promise<string> => {
  const { mkdtemp } = await import("node:fs/promises");
  const tempVault = await mkdtemp(path.join(os.tmpdir(), "pa-vault-"));
  tempPaths.push(tempVault);
  return tempVault;
};

describe("obsidian node helpers", () => {
  it("prevents path traversal outside the vault", () => {
    expect(() => resolveVaultPath("/tmp/vault", "../escape.md")).toThrow(
      "Markdown path must stay inside the local vault.",
    );
  });

  it("creates and appends markdown content safely", async () => {
    const vaultRoot = await createTempVault();

    await applyMarkdownWrite(vaultRoot, {
      relativePath: "daily/2024-05-15.md",
      operation: "create_new",
      content: "First entry",
      summary: "Created note",
    });

    await applyMarkdownWrite(vaultRoot, {
      relativePath: "daily/2024-05-15.md",
      operation: "append",
      content: "Second entry",
      summary: "Appended note",
    });

    const saved = await readFile(path.join(vaultRoot, "daily/2024-05-15.md"), "utf8");

    expect(saved).toBe("First entry\n\nSecond entry\n");
  });
});

describe("createObsidianNode", () => {
  it("loads the Obsidian system prompt from markdown", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("# Role & Core Objective");
    expect(prompt).toContain("# System Operational Rules");
    expect(prompt).toContain("Only target markdown files ending strictly with `.md`.");
    expect(prompt).toContain("Keep routine logs, daily plans, schedules, and task lists organized under the `routine/` subdirectory");
  });

  it("writes the markdown file returned by the structured output chain", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => ({
      relativePath: "notes/test.md",
      operation: "create_new",
      content: "# Test\nBody",
      summary: "Saved the note",
    }));
    const obsidianNode = createObsidianNode(connector, vaultRoot);

    const result = await obsidianNode({
      messages: [new HumanMessage("save this note")],
      context: {},
      next: undefined,
    });

    const saved = await readFile(path.join(vaultRoot, "notes/test.md"), "utf8");

    expect(saved).toBe("# Test\nBody\n");
    expect(result.messages?.[0]?.content).toBe("Saved the note Saved to notes/test.md.");
  });

  it("passes the markdown-backed system prompt into the writer chain", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect(input[0]).toHaveProperty("content");
      expect((input[0] as HumanMessage).content).toContain("# System Operational Rules");
      expect((input[0] as HumanMessage).content).toContain("Only target markdown files ending strictly with `.md`.");

      return {
        relativePath: "notes/prompt-check.md",
        operation: "create_new",
        content: "Prompt checked",
        summary: "Prompt used",
      };
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot);

    await obsidianNode({
      messages: [new HumanMessage("save prompt check")],
      context: {},
      next: undefined,
    });

    const saved = await readFile(path.join(vaultRoot, "notes/prompt-check.md"), "utf8");

    expect(saved).toBe("Prompt checked\n");
  });

  it("supports hot-reloading prompt content during development via the shared loader", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pa-obsidian-prompt-"));
    tempPaths.push(tempDir);
    const promptPath = path.join(tempDir, "prompt.md");

    await writeFile(promptPath, "Prompt one\n", "utf8");
    const loadPrompt = createPromptLoader(promptPath, { hotReload: true });

    expect(loadPrompt()).toBe("Prompt one");

    await writeFile(promptPath, "Prompt two\n", "utf8");

    expect(loadPrompt()).toBe("Prompt two");
  });
});