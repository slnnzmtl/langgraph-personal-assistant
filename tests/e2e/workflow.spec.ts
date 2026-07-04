import { test, expect } from "@playwright/test";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HumanMessage } from "@langchain/core/messages";

import { createWorkflowGraph } from "../../src/graph/workflow-graph.js";
import { MESSAGE_HISTORY_LIMIT } from "../../src/state.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const workflowConfig = {
  configurable: {
    thread_id: "test-thread",
  },
};

test.describe("workflow graph", () => {
  test("routes a general message to FINISH and returns a direct reply", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer from supervisor",
    }));

    const app = createWorkflowGraph(connector, {
      obsidianVaultPath: path.join(os.tmpdir(), "unused-vault"),
      appTimezone: "UTC",
    });

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

      return {
        relativePath: "notes/e2e.md",
        operation: "create_new",
        content: "# E2E\nSaved through the graph",
        summary: "Documented the request",
      };
    });

    try {
      const app = createWorkflowGraph(connector, {
        obsidianVaultPath: vaultRoot,
        appTimezone: "UTC",
      });

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("save this note to the vault")],
        },
        workflowConfig,
      );

      const saved = await readFile(path.join(vaultRoot, "notes/e2e.md"), "utf8");

      expect(saved).toBe("# E2E\nSaved through the graph\n");
      expect(finalState.messages.at(-1)?.content).toBe(
        "Documented the request Saved to notes/e2e.md.",
      );
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

      return {
        relativePath: `routine/${month}/${month} 5 - ${weekday}.md`,
        operation: "read",
      };
    });

    try {
      const app = createWorkflowGraph(connector, {
        obsidianVaultPath: vaultRoot,
        appTimezone: "UTC",
      });

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("give me a plan for today")],
        },
        workflowConfig,
      );

      expect(finalState.messages.at(-1)?.content).toBe(
        `Contents of routine/${month}/${month} 5 - ${weekday}.md:\n\n# Today\nPlan for today`,
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("routes a finance request to the finance mock branch", async () => {
    const connector = new FakeLLMConnector(() => ({ next: "Finance_SG" }));
    const app = createWorkflowGraph(connector, {
      obsidianVaultPath: path.join(os.tmpdir(), "unused-finance-vault"),
      appTimezone: "UTC",
    });

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("log my coffee expense")],
      },
      workflowConfig,
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Mock Finance Sub-Graph Executed. Phase 1 only wires routing and Telegram delivery.",
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
          return {
            relativePath: "notes/turn-6.md",
            operation: "create_new",
            content: "Turn 6 saved to the vault",
            summary: "Saved turn 6",
          };
        }

        if (latestMessage instanceof HumanMessage) {
          const latestText = typeof latestMessage.content === "string"
            ? latestMessage.content
            : JSON.stringify(latestMessage.content);

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
      const app = createWorkflowGraph(connector, {
        obsidianVaultPath: vaultRoot,
        appTimezone: "UTC",
      });

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
      expect(messageContents).toContain("Handled turn 12");
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});