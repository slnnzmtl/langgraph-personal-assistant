import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createObsidianVaultTools } from "../../../src/runtime-agents/policies/obsidian/tools.js";
import {
  applyFileWrite,
  listDirContents,
  listFiles,
  resolveVaultPath,
  searchFiles,
} from "../../../src/services/obsidian.js";
import { mapObsidianSubAgentResult } from "../../../src/app/policies/obsidian-hooks.js";
import { createObsidianNode } from "../../helpers/policy-nodes.js";
import { extractMessageTextContent } from "../../../src/utils/message-content.js";
import {
  createPromptLoader,
  loadObsidianSystemPrompt,
} from "../../../src/prompts/load-system-prompt.js";
import { FakeLLMConnector, getBuiltinRuntimeAgentDefinition } from "../../helpers/fakes.js";

const obsidianDefinition = getBuiltinRuntimeAgentDefinition("obsidian");

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

describe("mapObsidianSubAgentResult", () => {
  it("returns the final reply even when stepCount equals maxSteps", () => {
    const finalReply = new AIMessage("OK. I've created English learning.md.");
    const result = mapObsidianSubAgentResult(
      {
        messages: [
          new HumanMessage("Save to note English learning"),
          new AIMessage({
            content: "",
            tool_calls: [{
              name: "write_file",
              args: { relativePath: "English learning.md" },
              id: "write-1",
              type: "tool_call",
            }],
          }),
          new ToolMessage({
            tool_call_id: "write-1",
            content: "Success: Create English learning note and add link. saved to English learning.md.",
          }),
          finalReply,
        ],
        stepCount: 8,
      },
      8,
      () => ({ messages: [new AIMessage("exceeded max steps")] }),
    );

    expect(result.messages[0]?.content).toBe("OK. I've created English learning.md.");
  });

  it("summarizes a successful write when maxSteps is hit without a final reply", () => {
    const result = mapObsidianSubAgentResult(
      {
        messages: [
          new HumanMessage("Save to note English learning"),
          new AIMessage({
            content: "",
            tool_calls: [{
              name: "write_file",
              args: { relativePath: "English learning.md" },
              id: "write-1",
              type: "tool_call",
            }],
          }),
          new ToolMessage({
            tool_call_id: "write-1",
            content: "Success: Create English learning note and add link. saved to English learning.md.",
          }),
          new AIMessage({
            content: "",
            tool_calls: [{
              name: "list_files",
              args: { relativeDir: "." },
              id: "list-1",
              type: "tool_call",
            }],
          }),
        ],
        stepCount: 8,
      },
      8,
      () => ({ messages: [new AIMessage("exceeded max steps")] }),
    );

    expect(result.messages[0]?.content).toContain("Create English learning note and add link");
  });

  it("reports max steps only when the edit did not complete", () => {
    const result = mapObsidianSubAgentResult(
      {
        messages: [
          new HumanMessage("keep searching forever"),
          new AIMessage({
            content: "",
            tool_calls: [{
              name: "search_files",
              args: { queries: ["loop"] },
              id: "search-1",
              type: "tool_call",
            }],
          }),
          new ToolMessage({
            tool_call_id: "search-1",
            content: "No files matched your search.",
          }),
        ],
        stepCount: 3,
      },
      3,
      () => ({ messages: [new AIMessage("exceeded max steps")] }),
    );

    expect(result.messages[0]?.content).toBe("exceeded max steps");
  });
});

describe("obsidian node helpers", () => {
  it("prevents path traversal outside the vault", () => {
    expect(() => resolveVaultPath("/tmp/vault", "../escape.md")).toThrow(
      "Path traversal is forbidden.",
    );
  });

  it("lists and searches all file types", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile } = await import("node:fs/promises");

    await mkdir(path.join(vaultRoot, "daily"), { recursive: true });
    await writeFile(path.join(vaultRoot, "daily", "note.md"), "alpha beta", "utf8");
    await writeFile(path.join(vaultRoot, "daily", "note.txt"), "alpha beta", "utf8");
    await mkdir(path.join(vaultRoot, "daily", "nested"), { recursive: true });
    await writeFile(path.join(vaultRoot, "daily", "nested", "deep.md"), "gamma", "utf8");

    await expect(listFiles(vaultRoot, "daily")).resolves.toEqual([
      "daily/note.md",
      "daily/note.txt",
    ]);

    await expect(listDirContents(vaultRoot, "daily")).resolves.toEqual({
      files: ["daily/note.md", "daily/note.txt"],
      dirs: ["nested"],
    });

    await expect(searchFiles(vaultRoot, ["alpha", "gamma"], ".")).resolves.toEqual([
      "daily/nested/deep.md",
      "daily/note.md",
      "daily/note.txt",
    ]);
  });

  it("creates and appends markdown content safely", async () => {
    const vaultRoot = await createTempVault();

    await applyFileWrite(vaultRoot, {
      relativePath: "daily/2024-05-15.md",
      operation: "create_new",
      content: "First entry",
      summary: "Created note",
    });

    await applyFileWrite(vaultRoot, {
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
    const tools = createObsidianVaultTools(vaultRoot) as Array<{
      name?: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
    const readTool = tools.find((tool) => tool.name === "read_file");
    const writeTool = tools.find((tool) => tool.name === "write_file");

    expect(readTool).toBeDefined();
    expect(writeTool).toBeDefined();

    await expect(readTool!.invoke({ relativePath: "" })).rejects.toThrow();
    await expect(
      writeTool!.invoke({
        relativePath: "note.md",
        operation: "append",
        summary: "Append note",
        content: "More content",
      }),
    ).resolves.toContain("Success: Append note");
  });

  it("reads markdown with plain contents for the model", async () => {
    const vaultRoot = await createTempVault();

    await applyFileWrite(vaultRoot, {
      relativePath: "notes/read.md",
      operation: "create_new",
      content: "Alpha\nBeta\n",
      summary: "Created read note",
    });

    const tools = createObsidianVaultTools(vaultRoot) as Array<{
      name?: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
    const readTool = tools.find((tool) => tool.name === "read_file");

    expect(readTool).toBeDefined();

    const output = await readTool!.invoke({ relativePath: "notes/read.md" });

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
  it("loads the Obsidian system prompt from prompts/obsidian.xml", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("Obsidian Vault Manager");
    expect(prompt).toContain("<role_and_rules>");
    expect(prompt).toContain("<priority>");
    expect(prompt).toContain("Paths: Relative only. No absolute paths or '..' traversal.");
    expect(prompt).toContain("CURRENT DATETIME:");
    expect(prompt).toContain('<intent type="READ">');
    expect(prompt).toContain('<intent type="WRITE">');
    expect(prompt).toContain('<intent type="FIND_OR_SEARCH">');
    expect(prompt).toContain("file deletion is not available");
  });

  it("loads skill_usage guidance from prompts/obsidian.xml", () => {
    const prompt = loadObsidianSystemPrompt();

    expect(prompt).toContain("<skill_usage>");
    expect(prompt).toContain("read_skill(skill_name)");
    expect(prompt).toContain("<skill_attachments>");
  });

  it("fails clearly when the model does not support tool calling", async () => {
    const vaultRoot = await createTempVault();
    const connector = {
      getModel: () => ({}) as BaseChatModel,
    };

    expect(() => createObsidianNode(connector, vaultRoot, obsidianDefinition)).toThrow(
      "Runtime agent LLM model must support tool calling.",
    );
  });

  it("falls back to a non-empty completion when the model returns blank text", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector(() => new AIMessage(""));
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [new HumanMessage("create a note for today")],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Completed the Obsidian task.");
  });

  it("includes the current date and routine path hint in the prompt", async () => {
    const vaultRoot = await createTempVault();
    const currentInstant = new Date("2026-07-05T00:30:00.000Z");
    const utcTimezone = "UTC";
    const { mkdir, writeFile } = await import("node:fs/promises");
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: utcTimezone }).format(currentInstant);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: utcTimezone }).format(currentInstant);
    const day = Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: utcTimezone }).format(currentInstant));

    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    await mkdir(path.join(vaultRoot, "routine", month), { recursive: true });
    await writeFile(path.join(vaultRoot, `routine/${month}/${month} ${day} - ${weekday}.md`), "# Today\nPlan\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");
      const expectedRoutinePath = `routine/${month}/${month} ${day} - ${weekday}.md`;

      expect(promptContent).toContain("CURRENT DATETIME:");
      expect(promptContent).toContain(expectedRoutinePath);
      expect(promptContent).toContain("Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.");
      expect(promptContent).toContain(`Today: ${expectedRoutinePath}`);
      expect(promptContent).toContain("<attached_skills>");

      return new AIMessage("Done.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [new HumanMessage("give me a plan for today")],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Done.");
  });

  it("auto-attaches the Routine skill when the user message matches routine intent", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).toContain("<attached_skills>");
      expect(promptContent).toContain('<attached_skill name="daily-routine-note-creation">');
      expect(promptContent).toContain("Step 1: Read yesterday's note");
      expect(promptContent).toContain("Follow the attached skill instructions exactly");

      return new AIMessage("Prepared today's routine note.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [new HumanMessage("create today's routine note")],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Prepared today's routine note.");
  });

  it("does not attach the Routine skill for unrelated vault requests", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).not.toContain("<attached_skills>");
      expect(promptContent).not.toContain('<attached_skill name="daily-routine-note-creation">');

      return new AIMessage("Read the fitness log.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [new HumanMessage("read my fitness log")],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Read the fitness log.");
  });

  it("summarizes read_file results when the model returns a blank final response", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      if (!Array.isArray(input)) {
        return new AIMessage("");
      }

      const latestMessage = input.at(-1);
      if (latestMessage instanceof ToolMessage) {
        return new AIMessage("");
      }

      return new AIMessage({
        content: "",
        tool_calls: [{
          name: "read_file",
          args: { relativePath: "routine/July/July 16 - Thu.md" },
          id: "read-today",
          type: "tool_call",
        }],
      });
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [
        new HumanMessage("today's plan"),
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "read_file",
            args: { relativePath: "routine/July/July 16 - Thu.md" },
            id: "read-today",
            type: "tool_call",
          }],
        }),
        new ToolMessage({
          name: "read_file",
          tool_call_id: "read-today",
          content: "Contents of routine/July/July 16 - Thu.md:\n\n## Summary\n- [ ] Gym",
        }),
      ],
      stepCount: 2,
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toContain("## Summary");
    expect(firstMessage?.content).toContain("- [ ] Gym");
  });

  it("injects the vault directory tree without file names", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile } = await import("node:fs/promises");

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await mkdir(path.join(vaultRoot, "projects", "alpha"), { recursive: true });
    await writeFile(path.join(vaultRoot, "routine", "July", "July 5 - Sun.md"), "# Today\n", "utf8");
    await writeFile(path.join(vaultRoot, "inbox.md"), "# Inbox\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).toContain("Vault directory tree (folders only):");
      expect(promptContent).toContain(".\n  projects\n    projects/alpha\n  routine\n    routine/July");
      expect(promptContent).not.toContain("July 5 - Sun.md");
      expect(promptContent).not.toContain("inbox.md");

      return new AIMessage("Done.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [new HumanMessage("show me the vault structure")],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Done.");
  });

  it("injects prior tool-result context and a pending write instruction after a read step", async () => {
    const vaultRoot = await createTempVault();
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).toContain("- [ ] Buy milk");

      return new AIMessage("Done.");
    });
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [
        new HumanMessage("create a note for today, move unchecked todos from yesterday's note"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_file",
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
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Done.");
  });

  it("compresses broad search results into a shorter final answer", async () => {
    const vaultRoot = await createTempVault();
    const rawSearchResult = [
      "events/potuzhno/techno-yoga/Places.md",
      "routine 1/July/July 3 - Fri.md",
      "routine 1/July/July 4 - Sat.md",
      "routine/July/July 3 - Fri.md",
      "routine/July/July 4 - Sat.md",
      "routine/July/July 5 - Sun.md",
    ].join("\n");

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptContent = (input as Array<{ content: unknown }>)
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
        .join("\n");

      expect(promptContent).toContain(rawSearchResult);

      return new AIMessage("Best matches:\nroutine/July/July 3 - Fri.md\nroutine/July/July 4 - Sat.md");
    });

    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [
        new HumanMessage("find routine note matches for potuzhno event note"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "search_files",
              args: { queries: ["potuzhno", "event", "note"] },
              id: "search-1",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          name: "search_files",
          tool_call_id: "search-1",
          content: rawSearchResult,
        }),
      ],
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    const finalText = typeof firstMessage?.content === "string" ? firstMessage.content : JSON.stringify(firstMessage?.content ?? "");

    expect(finalText).toContain("routine/July/July 3 - Fri.md");
    expect(finalText).toContain("routine/July/July 4 - Sat.md");
    expect(finalText).not.toContain("routine/July/July 5 - Sun.md");
    expect(finalText.split("\n")).toHaveLength(3);
  });

  it("finds notes by path terms even when the body does not contain the query", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile } = await import("node:fs/promises");

    await mkdir(path.join(vaultRoot, "events", "potuzhno", "techno-yoga"), { recursive: true });
    await writeFile(path.join(vaultRoot, "events", "potuzhno", "techno-yoga", "Places.md"), "No matching keywords here", "utf8");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["techno yoga"] }) as string;

    expect(result).toContain("events/potuzhno/techno-yoga/Places.md");
    expect(result).not.toContain("No files matched your search.");
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
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [
        new HumanMessage("add sauna to today's plan"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "write_file",
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
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Added sauna to today's tasks in your routine.");
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
    const obsidianNode = createObsidianNode(connector, vaultRoot, obsidianDefinition);

    const result = await obsidianNode({
      messages: [
        new HumanMessage("collect and save today's note"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_file",
              args: { relativePath: "routine/July/July 5 - Sun.md" },
              id: "read-today",
              type: "tool_call",
            },
            {
              name: "write_file",
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
    });

    const firstMessage = Array.isArray(result.messages) ? result.messages[0] : undefined;
    expect(firstMessage?.content).toBe("Prepared today's note successfully.");
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

// ---------------------------------------------------------------------------
// list_files tool
// ---------------------------------------------------------------------------

describe("obsidian tool: list_files", () => {
  it("lists .md files and subdirectories in a given directory", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(path.join(vaultRoot, "notes", "sub"), { recursive: true });
    await wf(path.join(vaultRoot, "notes", "a.md"), "# A");
    await wf(path.join(vaultRoot, "notes", "b.md"), "# B");
    await wf(path.join(vaultRoot, "notes", "sub", "c.md"), "# C");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const listTool = tools.find((tool) => tool.name === "list_files");
    const result = await listTool!.invoke({ relativeDir: "notes" }) as string;

    expect(result).toContain("notes/a.md");
    expect(result).toContain("notes/b.md");
    expect(result).toContain("sub");
    expect(result).not.toContain("notes/sub/c.md");
  });

  it("defaults to vault root when relativeDir is omitted", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await wf(path.join(vaultRoot, "readme.md"), "# Readme");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const listTool = tools.find((tool) => tool.name === "list_files");
    const result = await listTool!.invoke({}) as string;

    expect(result).toContain("readme.md");
    expect(result).toContain("notes");
  });

  it("returns an error string for a non-existent directory", async () => {
    const vaultRoot = await createTempVault();

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const listTool = tools.find((tool) => tool.name === "list_files");
    const result = await listTool!.invoke({ relativeDir: "no-such-dir" }) as string;

    expect(result).toContain("Error:");
  });
});

// ---------------------------------------------------------------------------
// search_files tool
// ---------------------------------------------------------------------------

describe("obsidian tool: search_files", () => {
  it("finds files whose content matches any query term (OR semantics)", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "a.md"), "Hello World");
    await wf(path.join(vaultRoot, "b.md"), "goodbye");
    await wf(path.join(vaultRoot, "c.md"), "hello typescript");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["HELLO", "goodbye"] }) as string;

    expect(result).toContain("a.md");
    expect(result).toContain("b.md");
    expect(result).toContain("c.md");
  });

  it("finds files whose content matches a single query term", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "a.md"), "Hello World");
    await wf(path.join(vaultRoot, "b.md"), "goodbye");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["HELLO"] }) as string;

    expect(result).toContain("a.md");
    expect(result).not.toContain("b.md");
  });

  it("searches only within relativeDir when provided", async () => {
    const vaultRoot = await createTempVault();
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await mkdir(path.join(vaultRoot, "other"), { recursive: true });
    await wf(path.join(vaultRoot, "notes", "match.md"), "alpha");
    await wf(path.join(vaultRoot, "other", "nomatch.md"), "alpha");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["alpha"], relativeDir: "notes" }) as string;

    expect(result).toContain("notes/match.md");
    expect(result).not.toContain("other/nomatch.md");
  });

  it("lowercases queries before matching", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "x.md"), "TypeScript");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["TYPESCRIPT"] }) as string;

    expect(result).toContain("x.md");
  });

  it("de-duplicates results when multiple query terms match the same file", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "both.md"), "hello world");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["hello", "world"] }) as string;

    const lines = (result as string).split("\n");
    expect(lines.filter((line) => line.includes("both.md"))).toHaveLength(1);
  });

  it("returns an empty-result message when nothing matches", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "empty.md"), "nothing here");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files");
    const result = await searchTool!.invoke({ queries: ["zzznomatch"] }) as string;

    const lower = result.toLowerCase();
    expect(
      lower.includes("no files") || lower.includes("no results") || lower.includes("no matches") || result.trim() === "",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search_files_by_name tool
// ---------------------------------------------------------------------------

describe("obsidian tool: search_files_by_name", () => {
  it("finds files whose filename matches all query terms (AND semantics)", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "July 1 - Tue.md"), "# Day 1");
    await wf(path.join(vaultRoot, "July 2 - Wed.md"), "# Day 2");
    await wf(path.join(vaultRoot, "August 1 - Fri.md"), "# Wrong month");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files_by_name");
    const result = await searchTool!.invoke({ queries: ["July", "1"] }) as string;

    expect(result).toContain("July 1 - Tue.md");
    expect(result).not.toContain("July 2 - Wed.md");
    expect(result).not.toContain("August 1 - Fri.md");
  });

  it("auto-splits multi-word query strings before matching", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "July 1 - Tue.md"), "# Day 1");
    await wf(path.join(vaultRoot, "July 2 - Wed.md"), "# Day 2");

    const tools = createObsidianVaultTools(vaultRoot) as Array<{ name?: string; invoke(input: unknown): Promise<unknown> }>;
    const searchTool = tools.find((tool) => tool.name === "search_files_by_name");
    const result = await searchTool!.invoke({ queries: ["July 1"] }) as string;

    expect(result).toContain("July 1 - Tue.md");
    expect(result).not.toContain("July 2 - Wed.md");
  });
});

// ---------------------------------------------------------------------------
// send_file tool
// ---------------------------------------------------------------------------

describe("obsidian tool: send_file", () => {
  it("sends a file via the fileSender when provided", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "document.md"), "# Important\nContent here");

    const mockFileSender = {
      sendFile: vi.fn(async () => undefined),
      setCurrentChatId: vi.fn(),
    };

    const tools = createObsidianVaultTools(vaultRoot, mockFileSender) as Array<{
      name?: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
    const sendFileTool = tools.find((tool) => tool.name === "send_file");

    const result = await sendFileTool!.invoke({ relativePath: "document.md" }) as string;

    expect(result).toContain("File sent: document.md");
    expect(mockFileSender.sendFile).toHaveBeenCalledOnce();
    expect(mockFileSender.sendFile).toHaveBeenCalledWith(
      expect.stringContaining("document.md"),
    );
  });

  it("returns an error when the file does not exist", async () => {
    const vaultRoot = await createTempVault();
    const mockFileSender = {
      sendFile: vi.fn(async () => undefined),
      setCurrentChatId: vi.fn(),
    };

    const tools = createObsidianVaultTools(vaultRoot, mockFileSender) as Array<{
      name?: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
    const sendFileTool = tools.find((tool) => tool.name === "send_file");

    const result = await sendFileTool!.invoke({ relativePath: "nonexistent.md" }) as string;

    expect(result).toContain("Error");
    expect(result).toContain("does not exist");
    expect(mockFileSender.sendFile).not.toHaveBeenCalled();
  });

  it("is absent from the tools array when no fileSender is provided", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "file.md"), "content");

    const toolsWithout = createObsidianVaultTools(vaultRoot) as Array<{ name?: string }>;
    const toolsWith = createObsidianVaultTools(vaultRoot, {
      sendFile: vi.fn(async () => undefined),
      setCurrentChatId: vi.fn(),
    }) as Array<{ name?: string }>;

    expect(toolsWithout.length).toBe(5); // read, write, list, search_files, search_files_by_name
    expect(toolsWith.length).toBe(6); // same 5 + send_file

    const sendFileToolInWithout = toolsWithout.find((t) => t.name === "send_file");
    const sendFileToolInWith = toolsWith.find((t) => t.name === "send_file");

    expect(sendFileToolInWithout).toBeUndefined();
    expect(sendFileToolInWith).toBeDefined();
  });

  it("returns a sendFile error when the Telegram API call fails", async () => {
    const vaultRoot = await createTempVault();
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(vaultRoot, "file.md"), "content");

    const sendError = new Error("Telegram API: file too large");
    const mockFileSender = {
      sendFile: vi.fn(async () => {
        throw sendError;
      }),
      setCurrentChatId: vi.fn(),
    };

    const tools = createObsidianVaultTools(vaultRoot, mockFileSender) as Array<{
      name?: string;
      invoke(input: unknown): Promise<unknown>;
    }>;
    const sendFileTool = tools.find((tool) => tool.name === "send_file");

    const result = await sendFileTool!.invoke({ relativePath: "file.md" }) as string;

    expect(result).toContain("Error");
    expect(result).toContain("file too large");
  });
});
