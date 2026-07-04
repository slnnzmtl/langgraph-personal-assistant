import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  vi.useRealTimers();
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
    expect(prompt).toContain("Keep routine logs, daily plans, schedules, and task lists organized under the `routine/[Month]/[Month] [Day] - [Weekday].md` pattern.");
  });

  it("writes the markdown file returned by the structured output chain", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => ({
      relativePath: "notes/test.md",
      operation: "create_new",
      content: "# Test\nBody",
      summary: "Saved the note",
    }));
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("save this note")],
      context: {},
      next: undefined,
    });

    const saved = await readFile(path.join(vaultRoot, "notes/test.md"), "utf8");

    expect(saved).toBe("# Test\nBody\n");
    expect(result.messages?.[0]?.content).toBe("Saved the note Saved to notes/test.md.");
  });

  it("reads the markdown file returned by the structured output chain", async () => {
    const vaultRoot = await createTempVault();
    await applyMarkdownWrite(vaultRoot, {
      relativePath: "notes/read.md",
      operation: "create_new",
      content: "# Read\nBody",
      summary: "Seeded read file",
    });

    const connector = new FakeLLMConnector(() => ({
      relativePath: "notes/read.md",
      operation: "read",
    }));
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("read this note")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Contents of notes/read.md:\n\n# Read\nBody");
  });

  it("deletes the markdown file returned by the structured output chain", async () => {
    const vaultRoot = await createTempVault();
    await applyMarkdownWrite(vaultRoot, {
      relativePath: "notes/delete.md",
      operation: "create_new",
      content: "Delete me",
      summary: "Seeded delete file",
    });

    const connector = new FakeLLMConnector(() => ({
      relativePath: "notes/delete.md",
      operation: "delete",
      summary: "Removed note",
    }));
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("delete this note")],
      context: {},
      next: undefined,
    });

    await expect(readFile(path.join(vaultRoot, "notes/delete.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result.messages?.[0]?.content).toBe("Removed note Deleted notes/delete.md.");
  });

  it("passes the markdown-backed system prompt into the writer chain", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];
      expect(promptMessages[0]).toHaveProperty("content");
      expect(promptMessages[0].content).toContain("# System Operational Rules");
      expect(promptMessages[0].content).toContain("Only target markdown files ending strictly with `.md`.");
      expect(promptMessages[0].content).toContain("Current date:");
      expect(promptMessages[0].content).toContain("Current time:");

      return {
        relativePath: "notes/prompt-check.md",
        operation: "create_new",
        content: "Prompt checked",
        summary: "Prompt used",
      };
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    await obsidianNode({
      messages: [new HumanMessage("save prompt check")],
      context: {},
      next: undefined,
    });

    const saved = await readFile(path.join(vaultRoot, "notes/prompt-check.md"), "utf8");

    expect(saved).toBe("Prompt checked\n");
  });

  it("includes the current date and routine path hint in the prompt", async () => {
    const vaultRoot = await createTempVault();
    const appTimezone = "America/New_York";
    const currentInstant = new Date("2026-07-05T00:30:00.000Z");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: appTimezone }).format(currentInstant);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: appTimezone }).format(currentInstant);
    const day = Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: appTimezone }).format(currentInstant));

    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    await mkdir(path.join(vaultRoot, "routine", month), { recursive: true });
    await writeFile(path.join(vaultRoot, `routine/${month}/${month} ${day} - ${weekday}.md`), "# Today\nPlan\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as HumanMessage[])
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");
      const expectedRoutinePath = `routine/${month}/${month} ${day} - ${weekday}.md`;

      expect(promptContent).toContain("Current date:");
      expect(promptContent).toContain("Current time:");
      expect(promptContent).toContain(expectedRoutinePath);
      expect(promptContent).toContain("Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.");

      return {
        relativePath: expectedRoutinePath,
        operation: "read",
      };
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, appTimezone);

    const result = await obsidianNode({
      messages: [new HumanMessage("give me a plan for today")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toContain("Contents of routine/");
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