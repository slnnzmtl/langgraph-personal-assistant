import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyMarkdownWrite,
  createObsidianNode,
  createObsidianTools,
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

  it("validates Obsidian tool inputs with Zod schemas", async () => {
    const vaultRoot = await createTempVault();
    const [readTool, writeTool] = createObsidianTools(vaultRoot) as Array<{
      invoke(input: unknown): Promise<unknown>;
    }>;

    await expect(readTool.invoke({ relativePath: "note.txt" })).rejects.toThrow();
    await expect(
      writeTool.invoke({
        relativePath: "note.md",
        operation: "append",
        summary: "Append note",
      }),
    ).rejects.toThrow();
  });
});

describe("createObsidianNode", () => {
  it("loads the Obsidian system prompt from markdown", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("# Role & Core Objective");
    expect(prompt).toContain("# System Operational Rules");
    expect(prompt).toContain("The runtime injects today's current date and time into the system prompt.");
    expect(prompt).toContain("Task Formatting: Always use checkbox list items `- [ ]` for incomplete tasks.");
    expect(prompt).toContain(
      "Directory Rules: Keep routine logs, daily plans, and task lists under `routine/[Month]/[Month] [Day] - [Weekday].md`.",
    );
  });

  it("passes the markdown-backed system prompt into the tool-bound model", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];
      expect(promptMessages[0]).toHaveProperty("content");
      expect(promptMessages[0].content).toContain("# System Operational Rules");
      expect(promptMessages[0].content).toContain("Current date:");
      expect(promptMessages[0].content).toContain("Current time:");
      expect(promptMessages[0].content).toContain("Current date: 2026-07-05");

      return new AIMessage("Completed the note.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("save prompt check")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Completed the note.");
  });

  it("fails clearly when the model does not support tool calling", async () => {
    const vaultRoot = await createTempVault();
    const connector = {
      getModel: () => ({}) as BaseChatModel,
    };

    expect(() => createObsidianNode(connector, vaultRoot, "UTC")).toThrow(
      "Obsidian tool-bound model must support tool calling.",
    );
  });

  it("falls back to a non-empty completion when the model returns blank text", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => new AIMessage(""));
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("create a note for today")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Completed the Obsidian task.");
  });

  it("fails closed when the model asks for clarification instead of using the tools", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => new AIMessage("What is the current date?"));
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [new HumanMessage("create a note for today")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe(
      "Unable to edit the local markdown vault: the Obsidian model requested clarification instead of using the injected date and filesystem tools.",
    );
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
      expect(promptContent).toContain("Routine note availability:");
      expect(promptContent).toContain(`- Today: exists at ${expectedRoutinePath}`);

      return new AIMessage("Done.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, appTimezone);

    const result = await obsidianNode({
      messages: [new HumanMessage("give me a plan for today")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Done.");
  });

  it("injects prior tool-result context and a pending write instruction after a read step", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as HumanMessage[])
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).toContain("Obsidian loop context:");
      expect(promptContent).toContain("Original user request: create a note for today, move unchecked todos from yesterday's note");
      expect(promptContent).toContain("Last tool call: read_markdown_file on routine/July/July 4 - Sat.md.");
      expect(promptContent).toContain("- [ ] Buy milk");
      expect(promptContent).toContain("The user request still requires a markdown write step. Do not finish yet.");

      return new AIMessage("Done.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [
        new HumanMessage("create a note for today, move unchecked todos from yesterday's note"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_markdown_file",
              args: { relativePath: "routine/July/July 4 - Sat.md" },
              id: "read-yesterday",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "read-yesterday",
          content: "## Tasks\n\n- [ ] Buy milk\n- [x] Archive receipt\n",
        }),
      ],
      context: { obsidianToolStepCount: 1 },
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Done.");
  });

  it("returns the terminal write tool result without reinvoking the model", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => {
      throw new Error("The model should not be reinvoked after a terminal tool result.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [
        new HumanMessage("add sauna to today's plan"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "write_markdown_file",
              args: {
                relativePath: "routine/July/July 5 - Sun.md",
                operation: "append",
                content: "- [ ] Go to sauna after noon",
                summary: "Added sauna to today's tasks.",
              },
              id: "write-today",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "write-today",
          content: "Success: Added sauna to today's tasks. Saved to routine/July/July 5 - Sun.md.",
        }),
      ],
      context: { obsidianToolStepCount: 1 },
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe(
      "Added sauna to today's tasks. Saved to routine/July/July 5 - Sun.md.",
    );
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
