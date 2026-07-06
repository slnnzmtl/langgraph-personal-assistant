import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyMarkdownWrite,
  resolveVaultPath,
  createObsidianTools,
} from "../../src/nodes/obsidian/obsidian-tools.js";
import {
  createObsidianNode,
} from "../../src/nodes/obsidian/obsidian-node.js";
import { extractMessageTextContent } from "../../src/nodes/message-history.js";
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
        content: "More content",
      }),
    ).resolves.toContain("Success: Append note");
  });

  it("reads markdown with plain contents for the model", async () => {
    const vaultRoot = await createTempVault();

    await applyMarkdownWrite(vaultRoot, {
      relativePath: "notes/read.md",
      operation: "create_new",
      content: "Alpha\nBeta\n",
      summary: "Created read note",
    });

    const [readTool] = createObsidianTools(vaultRoot) as Array<{
      invoke(input: unknown): Promise<unknown>;
    }>;

    const output = await readTool.invoke({ relativePath: "notes/read.md" });

    expect(output).toContain("Alpha");
    expect(output).toContain("Beta");
  });

  it("unescapes literal newline markers in extracted message text", () => {
    const mixedContent = [
      "Line one\\nLine two",
      { type: "text", text: "Line three\\nLine four" },
    ] as unknown as Parameters<typeof extractMessageTextContent>[0];

    expect(extractMessageTextContent("Line one\\nLine two")).toBe("Line one\nLine two");
    expect(extractMessageTextContent(mixedContent)).toBe("Line one\nLine two\nLine three\nLine four");
  });
});

describe("createObsidianNode", () => {
  it("loads the Obsidian system prompt from markdown", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("# Role & Core Objective");
    expect(prompt).toContain("# System Operational Rules");
    expect(prompt).toContain("The runtime injects today's current date and time into the system prompt.");
    expect(prompt).toContain("A. READ INTENT");
    expect(prompt).toContain("B. WRITE / MODIFY INTENT");
    expect(prompt).toContain("'overwrite': To modify existing text, add tasks, or alter structures, call `read_markdown_file` first, apply your modifications to the text content, and overwrite the file completely.");
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

      expect(promptContent).toContain("Now:");
      expect(promptContent).toContain(expectedRoutinePath);
      expect(promptContent).toContain("Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.");
      expect(promptContent).toContain("For today, use");
      expect(promptContent).toContain(expectedRoutinePath);

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

      expect(promptContent).toContain("- [ ] Buy milk");

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
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Done.");
  });

  it("invokes the model with write-tool result to produce a natural-language summary", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");

      expect(promptContent).toContain("Added sauna to today's tasks.");

      return new AIMessage("Added sauna to today's tasks in your routine.");
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
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Added sauna to today's tasks in your routine.");
  });

  it("invokes the model after a full tool batch to produce a natural-language summary", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");

      expect(promptContent).toContain("Prepared today's note.");

      return new AIMessage("Prepared today's note successfully.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, "UTC");

    const result = await obsidianNode({
      messages: [
        new HumanMessage("collect and save today's note"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_markdown_file",
              args: { relativePath: "routine/July/July 5 - Sun.md" },
              id: "read-today",
              type: "tool_call",
            },
            {
              name: "write_markdown_file",
              args: {
                relativePath: "routine/July/July 5 - Sun.md",
                operation: "overwrite",
                content: "# Today\n- [ ] First\n",
                summary: "Prepared today's note.",
              },
              id: "write-today",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "read-today",
          content: "# Today\n- [ ] First\n",
        }),
        new ToolMessage({
          tool_call_id: "write-today",
          content: "Success: Prepared today's note. Saved to routine/July/July 5 - Sun.md.",
        }),
      ],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Prepared today's note successfully.");
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
