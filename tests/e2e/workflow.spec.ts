import { test, expect } from "@playwright/test";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { createWorkflowGraph } from "../../src/agent.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import { MESSAGE_HISTORY_LIMIT } from "../../src/state.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const testCronRepository: CronJobRepository = {
  loadJobs: async () => [],
  saveJobs: async () => {},
};

const makeWorkflowGraphConfig = (obsidianVaultPath: string) => ({
  obsidianVaultPath,
  cronJobRepository: testCronRepository,
});

const workflowConfig = {
  configurable: {
    thread_id: "test-thread",
  },
};

const makeToolCallMessage = (
  name: "read_file" | "write_file" | "delete_file",
  args: Record<string, unknown>,
  id = `${name}-call`,
) => new AIMessage({
  content: "",
  tool_calls: [
    {
      name,
      args,
      id,
      type: "tool_call",
    },
  ],
});

const getLatestRoutedUserText = (messages: Array<HumanMessage | AIMessage | ToolMessage>): string => {
  const latestMessage = messages.at(-1);

  if (!(latestMessage instanceof HumanMessage)) {
    throw new Error("Expected the latest routed message to be a human message.");
  }

  const latestText = typeof latestMessage.content === "string"
    ? latestMessage.content
    : JSON.stringify(latestMessage.content);

  return latestText;
};

test.describe("workflow graph", () => {
  test("routes a general message to FINISH and returns a direct reply", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer from supervisor",
    }));

    const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(path.join(os.tmpdir(), "unused-vault")));

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("hello")],
      },
      workflowConfig,
    );

    expect(finalState.messages.at(-1)?.content).toBe("Direct answer from supervisor");
  });

  test("routes a note request into the obsidian node and writes the markdown file", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-vault-"));
    let invocation = 0;

    const connector = new FakeLLMConnector(() => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (invocation === 2) {
        return makeToolCallMessage("write_file", {
          relativePath: "notes/e2e.md",
          operation: "create_new",
          content: "# E2E\nSaved through the graph",
          summary: "Documented the request",
        });
      }

      return {
        next: "FINISH",
        reply: "Documented the request Saved to notes/e2e.md.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("save this note to the vault")],
        },
        workflowConfig,
      );

      const saved = await readFile(path.join(vaultRoot, "notes/e2e.md"), "utf8");

      expect(saved).toBe("# E2E\nSaved through the graph\n");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Documented the request.",
      );
      expect(invocation).toBe(2);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("routes a retrieval request into the obsidian node and reads the existing markdown file", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-read-vault-"));
    const currentDate = new Date("2026-07-05T00:00:00.000Z");
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(currentDate);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(currentDate);
    await mkdir(path.join(vaultRoot, "routine", month), { recursive: true });
    await writeFile(path.join(vaultRoot, `routine/${month}/${month} 5 - ${weekday}.md`), "# Today\nPlan for today\n", "utf8");
    let invocation = 0;

    const connector = new FakeLLMConnector(() => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (invocation === 2) {
        return makeToolCallMessage("read_file", {
          relativePath: `routine/${month}/${month} 5 - ${weekday}.md`,
        });
      }

      if (invocation === 3) {
        return new AIMessage(
          `Contents of routine/${month}/${month} 5 - ${weekday}.md:\n\n# Today\nPlan for today`,
        );
      }

      return {
        next: "FINISH",
        reply: `Contents of routine/${month}/${month} 5 - ${weekday}.md:\n\n# Today\nPlan for today`,
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("give me a plan for today")],
        },
        workflowConfig,
      );

      expect(finalState.messages.at(-1)?.content).toBe(
        `Contents of routine/${month}/${month} 5 - ${weekday}.md:\n\n# Today\nPlan for today`,
      );
      expect(invocation).toBe(3);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("surfaces an Obsidian execution error instead of recursing", async () => {
    let invocation = 0;
    const failingConnector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (Array.isArray(input)) {
        if (invocation === 1) {
          return { next: "Obsidian_SG" };
        }

        throw new Error("Structured output validation failed");
      }

      return { next: "Obsidian_SG" };
    });

    const app = createWorkflowGraph(failingConnector, failingConnector, failingConnector, makeWorkflowGraphConfig(path.join(os.tmpdir(), "unused-error-vault")));

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("give a plan for yesterday")],
      },
      workflowConfig,
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Unable to edit the local markdown vault: Structured output validation failed",
    );
  });

  test("routes a finance request to the finance mock branch", async () => {
    const connector = new FakeLLMConnector(() => ({ next: "Finance_SG" }));
    const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(path.join(os.tmpdir(), "unused-finance-vault")));

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("log my coffee expense")],
      },
      workflowConfig,
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Finance sync not configured. Enable ENABLE_FINANCE_SYNC and provide Supabase credentials.",
    );
  });

  test("keeps only the last 10 messages across multi-turn same-thread execution", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-history-vault-"));
    const connector = new FakeLLMConnector((input) => {
      if (Array.isArray(input)) {
        const systemPrompt = input[0];
        const latestMessage = input.at(-1);

        if (
          systemPrompt &&
          "content" in systemPrompt &&
          typeof systemPrompt.content === "string" &&
          systemPrompt.content.includes("# System Operational Rules")
        ) {
          if (latestMessage instanceof ToolMessage) {
            return new AIMessage("Saved turn 6 Saved to notes/turn-6.md.");
          }

          return makeToolCallMessage("write_file", {
            relativePath: "notes/turn-6.md",
            operation: "create_new",
            content: "Turn 6 saved to the vault",
            summary: "Saved turn 6",
          }, "turn-6-write");
        }

        if (latestMessage instanceof HumanMessage) {
          const latestText = getLatestRoutedUserText(input as Array<HumanMessage | AIMessage | ToolMessage>);

          if (latestText.includes("save turn 6")) {
            return { next: "Obsidian_SG" };
          }

          return {
            next: "FINISH",
            reply: `Handled ${latestText}`,
          };
        }
      }

      throw new Error("Unexpected fake connector input in multi-turn e2e test.");
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      let finalState = await app.invoke(
        {
          messages: [new HumanMessage("turn 1")],
        },
        workflowConfig,
      );

      for (let turn = 2; turn <= 12; turn += 1) {
        const prompt = turn === 6 ? "please save turn 6" : `turn ${turn}`;
        finalState = await app.invoke(
          {
            messages: [new HumanMessage(prompt)],
          },
          workflowConfig,
        );
      }

      const saved = await readFile(path.join(vaultRoot, "notes/turn-6.md"), "utf8");
      const messageContents = finalState.messages.map((message) =>
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      );

      expect(saved).toBe("Turn 6 saved to the vault\n");
      expect(finalState.messages).toHaveLength(MESSAGE_HISTORY_LIMIT);
      expect(messageContents).not.toContain("turn 1");
      expect(messageContents).not.toContain("Handled turn 1");
      expect(messageContents).toContain("turn 12");
      expect(messageContents.some((message) => message.includes("Handled turn 12"))).toBe(true);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("moves unchecked tasks from yesterday into today's routine across multiple Obsidian steps", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-multistep-vault-"));
    const yesterdayPath = "routine/July/July 4 - Sat.md";
    const todayPath = "routine/July/July 5 - Sun.md";
    let invocation = 0;

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, yesterdayPath),
      "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (!Array.isArray(input)) {
        throw new Error("Expected an Obsidian prompt message array.");
      }

      const latestMessage = input.at(-1);

      if (invocation === 2) {
        expect(latestMessage).toBeInstanceOf(HumanMessage);

        return makeToolCallMessage("read_file", {
          relativePath: yesterdayPath,
        }, "read-yesterday");
      }

      if (invocation === 3) {
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("- [ ] Buy milk");

        return makeToolCallMessage("write_file", {
          relativePath: todayPath,
          operation: "append",
          content: "- [ ] Buy milk",
          summary: "Moved unchecked tasks from yesterday into today's routine",
        }, "append-today");
      }

      expect(latestMessage).toBeInstanceOf(HumanMessage);
      expect(getLatestRoutedUserText(input as Array<HumanMessage | AIMessage | ToolMessage>)).toBe(
        "move all unchecked tasks from yesterday into today's task",
      );

      return {
        next: "FINISH",
        reply: "Moved unchecked tasks from yesterday into today's routine Saved to routine/July/July 5 - Sun.md.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("move all unchecked tasks from yesterday into today's task")],
        },
        workflowConfig,
      );

      const todayContent = await readFile(path.join(vaultRoot, todayPath), "utf8");
      const yesterdayContent = await readFile(path.join(vaultRoot, yesterdayPath), "utf8");

      expect(todayContent).toContain("## Today");
      expect(todayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [x] Archive receipt");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Moved unchecked tasks from yesterday into today's routine Saved to routine/July/July 5 - Sun.md.",
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("returns a notice when today already exists and the first Obsidian step still chooses create_new", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-mixed-recovery-vault-"));
    const yesterdayPath = "routine/July/July 4 - Sat.md";
    const todayPath = "routine/July/July 5 - Sun.md";
    let invocation = 0;

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, yesterdayPath),
      "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (invocation === 2) {
        return makeToolCallMessage("write_file", {
          relativePath: todayPath,
          operation: "create_new",
          content: "## Today\n",
          summary: "Created today's routine note",
        }, "create-today");
      }

      if (!Array.isArray(input)) {
        throw new Error("Expected an Obsidian prompt message array.");
      }

      const latestMessage = input.at(-1);

      if (invocation === 3) {
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain(`Notice: File already exists at ${todayPath}.`);

        return makeToolCallMessage("read_file", {
          relativePath: yesterdayPath,
        }, "read-yesterday-after-notice");
      }

      if (invocation === 4) {
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("- [ ] Buy milk");

        return makeToolCallMessage("write_file", {
          relativePath: todayPath,
          operation: "append",
          content: "- [ ] Buy milk",
          summary: "Moved unchecked tasks from yesterday into today's routine",
        }, "append-after-read");
      }

      expect(latestMessage).toBeInstanceOf(HumanMessage);

      return {
        next: "FINISH",
        reply: "Moved unchecked tasks from yesterday into today's routine Saved to routine/July/July 5 - Sun.md.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("create a note for today, move unchecked todos from yesterday's note")],
        },
        workflowConfig,
      );

      const todayContent = await readFile(path.join(vaultRoot, todayPath), "utf8");
      const yesterdayContent = await readFile(path.join(vaultRoot, yesterdayPath), "utf8");

      expect(todayContent).toContain("## Today");
      expect(todayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [x] Archive receipt");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Moved unchecked tasks from yesterday into today's routine Saved to routine/July/July 5 - Sun.md.",
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("stops the Obsidian loop after the configured maximum number of tool steps", async () => {
    let invocation = 0;

    const connector = new FakeLLMConnector(() => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      return makeToolCallMessage("read_file", {
        relativePath: "routine/July/July 5 - Sun.md",
      }, `loop-step-${invocation}`);
    });

    const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(path.join(os.tmpdir(), "unused-loop-limit-vault")));

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("keep reading forever")],
      },
      {
        ...workflowConfig,
        recursionLimit: 40,
      },
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Unable to edit the local markdown vault: exceeded the maximum of 8 Obsidian tool steps.",
    );
  });

  test("marks a task complete by reading then editing the note", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-task-status-vault-"));
    const notePath = "routine/July/July 5 - Sun.md";
    let invocation = 0;

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(path.join(vaultRoot, notePath), "## Today\n- [ ] Go to sauna after noon\n- [ ] Review PRs\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (invocation === 2) {
        return makeToolCallMessage("read_file", {
          relativePath: notePath,
        }, "read-note");
      }

      if (invocation === 3) {
        if (!Array.isArray(input)) {
          throw new Error("Expected an Obsidian prompt message array.");
        }

        const latestMessage = input.at(-1);
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("- [ ] Go to sauna after noon");

        return makeToolCallMessage("write_file", {
          relativePath: notePath,
          operation: "overwrite",
          content: "## Today\n- [x] Go to sauna after noon\n- [ ] Review PRs",
          summary: "Marked 'Go to sauna after noon' as completed",
        }, "complete-sauna");
      }

      if (!Array.isArray(input)) {
        throw new Error("Expected an Obsidian prompt message array.");
      }

      const latestMessage = input.at(-1);
      expect(latestMessage).toBeInstanceOf(HumanMessage);

      return {
        next: "FINISH",
        reply: "Marked 'Go to sauna after noon' as completed.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("mark go to sauna after noon as completed")],
        },
        workflowConfig,
      );

      const saved = await readFile(path.join(vaultRoot, notePath), "utf8");

      expect(saved).toContain("- [x] Go to sauna after noon");
      expect(saved).toContain("- [ ] Review PRs");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Marked 'Go to sauna after noon' as completed.",
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("edits existing markdown content via the targeted edit tool", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-edit-note-vault-"));
    const notePath = "notes/today.md";
    let invocation = 0;

    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await writeFile(path.join(vaultRoot, notePath), "## Today\nPlan for today\n", "utf8");

    const connector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (invocation === 1) {
        return { next: "Obsidian_SG" };
      }

      if (invocation === 2) {
        return makeToolCallMessage("read_file", {
          relativePath: notePath,
        }, "read-today");
      }

      if (invocation === 3) {
        if (!Array.isArray(input)) {
          throw new Error("Expected an Obsidian prompt message array.");
        }

        const latestMessage = input.at(-1);
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("Plan for today");

        return makeToolCallMessage("write_file", {
          relativePath: notePath,
          operation: "overwrite",
          content: "## Today\nPlan for today\n- [ ] Go to sauna after noon",
          summary: "Updated today's note with the sauna plan",
        }, "edit-today");
      }

      if (!Array.isArray(input)) {
        throw new Error("Expected an Obsidian prompt message array.");
      }

      const latestMessage = input.at(-1);
      expect(latestMessage).toBeInstanceOf(HumanMessage);

      return {
        next: "FINISH",
        reply: "Updated today's note with the sauna plan.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("add go to sauna after noon under plan for today")],
        },
        workflowConfig,
      );

      const saved = await readFile(path.join(vaultRoot, notePath), "utf8");

      expect(saved).toContain("Plan for today");
      expect(saved).toContain("- [ ] Go to sauna after noon");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Updated today's note with the sauna plan.",
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("broadens search queries across multiple steps when initial search returns no results (try-fail-broaden loop)", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-search-broaden-vault-"));
    let invocation = 0;

    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    // File contains "gym" and "exercise" but not "workout"
    await writeFile(
      path.join(vaultRoot, "notes/fitness-log.md"),
      "# Fitness Log\nJuly 5: Went to gym\nDid morning exercise routine\n",
      "utf8",
    );
    // File contains "meeting" but not "sync"
    await writeFile(
      path.join(vaultRoot, "routine/July/July 5 - Sun.md"),
      "## Today\nHad a meeting with team at 2pm\n",
      "utf8",
    );

    const connector = new FakeLLMConnector((input) => {
      invocation += 1;

      if (invocation === 1) {
        // Supervisor routes to Obsidian
        return { next: "Obsidian_SG" };
      }

      if (!Array.isArray(input)) {
        throw new Error("Expected an Obsidian prompt message array in search broaden test.");
      }

      const latestMessage = input.at(-1);

      if (invocation === 2) {
        // First Obsidian invocation: model tries exact search "workout", gets no results
        expect(latestMessage).toBeInstanceOf(HumanMessage);
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "search_files",
              args: { queries: ["workout"] },
              id: "search-exact",
              type: "tool_call",
            },
          ],
        });
      }

      if (invocation === 3) {
        // Tool returns no results, model sees "No files matched your search."
        // Model now broadens with variants
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("No files matched");

        return new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "search_files",
              args: { queries: ["gym", "exercise", "fitness"] },
              id: "search-broaden-1",
              type: "tool_call",
            },
          ],
        });
      }

      if (invocation === 4) {
        // Broadened search succeeds and finds fitness-log.md
        expect(latestMessage).toBeInstanceOf(ToolMessage);
        expect(latestMessage?.content).toContain("fitness-log.md");

        return new AIMessage(
          "Found your fitness log from July 5. It mentions that you went to gym and did morning exercise routine.",
        );
      }

      // Final supervisor handoff
      expect(latestMessage).toBeInstanceOf(HumanMessage);
      return {
        next: "FINISH",
        reply: "Found your fitness log from July 5. It mentions that you went to gym and did morning exercise routine.",
      };
    });

    try {
      const app = createWorkflowGraph(connector, connector, connector, makeWorkflowGraphConfig(vaultRoot));

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("find my workout notes from July 5")],
        },
        workflowConfig,
      );

      expect(finalState.messages.at(-1)?.content).toBe(
        "Found your fitness log from July 5. It mentions that you went to gym and did morning exercise routine.",
      );
      expect(invocation).toBe(4);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});