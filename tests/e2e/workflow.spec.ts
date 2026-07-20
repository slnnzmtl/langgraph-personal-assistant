import { test, expect } from "@playwright/test";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { createTestWorkflowGraph } from "../helpers/workflow-graph.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import { FakeLLMConnector, createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";

const testCronRepository: CronJobRepository = {
  loadJobs: async () => [],
  saveJobs: async () => {},
  createJob: async (job) => job,
  deleteJob: async () => {
    throw new Error("Cron job not found");
  },
};

const makeWorkflowGraph = (
  connector: FakeLLMConnector,
  obsidianVaultPath: string,
  runtimeAgentRepository = createRuntimeAgentRepositoryFake(),
  runtimeAgents?: RuntimeAgentDefinition[],
  modelHandlers?: Parameters<typeof createTestWorkflowGraph>[0]["modelHandlers"],
) =>
  createTestWorkflowGraph({
    supervisorLlm: connector,
    obsidianVaultPath,
    cronJobRepository: testCronRepository,
    runtimeAgentRepository,
    runtimeAgents: runtimeAgents ?? buildTestRuntimeAgents(),
    ...(modelHandlers ? { modelHandlers } : {}),
  });

const createRouteSupervisor = (
  route: string | (() => unknown) = "obsidian",
): FakeLLMConnector =>
  new FakeLLMConnector(() => (typeof route === "function" ? route() : { next: route }));

const writeSuccessSummary = (summary: string, relativePath: string): string =>
  `${summary} saved to ${relativePath}.`;

const latestInputMessage = (
  input: unknown,
): HumanMessage | AIMessage | ToolMessage | undefined =>
  Array.isArray(input) ? input.at(-1) as HumanMessage | AIMessage | ToolMessage | undefined : undefined;

const obsidianDoneResponse = (): AIMessage => new AIMessage("");

const workflowConfig = {
  configurable: {
    thread_id: "test-thread",
  },
};

const makeToolCallMessage = (
  name: "read_file" | "write_file" | "search_files" | "search_files_by_name" | "list_files",
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

    const app = makeWorkflowGraph(connector, path.join(os.tmpdir(), "unused-vault"));

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

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("write_file", {
                relativePath: "notes/e2e.md",
                operation: "create_new",
                content: "# E2E\nSaved through the graph",
                summary: "Documented the request",
              });
            }

            return obsidianDoneResponse();
          },
        },
      );

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("save this note to the vault")],
        },
        workflowConfig,
      );

      const saved = await readFile(path.join(vaultRoot, "notes/e2e.md"), "utf8");

      expect(saved).toBe("# E2E\nSaved through the graph\n");
      expect(finalState.messages.at(-1)?.content).toBe(
        writeSuccessSummary("Documented the request", "notes/e2e.md"),
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
    const notePath = `routine/${month}/${month} 5 - ${weekday}.md`;
    await mkdir(path.join(vaultRoot, "routine", month), { recursive: true });
    await writeFile(path.join(vaultRoot, notePath), "# Today\nPlan for today\n", "utf8");

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("read_file", {
                relativePath: notePath,
              });
            }

            return obsidianDoneResponse();
          },
        },
      );

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("give me a plan for today")],
        },
        workflowConfig,
      );

      expect(finalState.messages.at(-1)?.content).toContain("# Today\nPlan for today");
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("surfaces an Obsidian execution error instead of recursing", async () => {
    const app = makeWorkflowGraph(
      createRouteSupervisor(),
      path.join(os.tmpdir(), "unused-error-vault"),
      undefined,
      undefined,
      {
        obsidian: () => {
          throw new Error("Structured output validation failed");
        },
      },
    );

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
    const connector = new FakeLLMConnector(() => ({ next: "finance" }));
    const app = makeWorkflowGraph(connector, path.join(os.tmpdir(), "unused-finance-vault"));

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("log my coffee expense")],
      },
      workflowConfig,
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Supabase session is not configured.",
    );
  });

  test("retains short multi-turn history within the token budget", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-history-vault-"));
    const connector = new FakeLLMConnector((input) => {
      if (Array.isArray(input)) {
        const latestMessage = input.at(-1);

        if (latestMessage instanceof HumanMessage) {
          const latestText = getLatestRoutedUserText(input as Array<HumanMessage | AIMessage | ToolMessage>);

          if (latestText.includes("save turn 6")) {
            return { next: "obsidian" };
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
      const app = makeWorkflowGraph(connector, vaultRoot, undefined, undefined, {
        obsidian: (input) => {
          const latestMessage = latestInputMessage(input);

          if (latestMessage instanceof ToolMessage) {
            return obsidianDoneResponse();
          }

          return makeToolCallMessage("write_file", {
            relativePath: "notes/turn-6.md",
            operation: "create_new",
            content: "Turn 6 saved to the vault",
            summary: "Saved turn 6",
          }, "turn-6-write");
        },
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
      expect(finalState.messages.length).toBeGreaterThan(10);
      expect(messageContents).toContain("turn 1");
      expect(messageContents.some((message) => message.includes("Handled turn 1"))).toBe(true);
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

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, yesterdayPath),
      "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("read_file", {
                relativePath: yesterdayPath,
              }, "read-yesterday");
            }

            if (latestMessage instanceof ToolMessage) {
              const toolContent = typeof latestMessage.content === "string"
                ? latestMessage.content
                : JSON.stringify(latestMessage.content);

              if (toolContent.includes("- [ ] Buy milk") && !toolContent.startsWith("Success:")) {
                return makeToolCallMessage("write_file", {
                  relativePath: todayPath,
                  operation: "append",
                  content: "- [ ] Buy milk",
                  summary: "Moved unchecked tasks from yesterday into today's routine",
                }, "append-today");
              }

              return obsidianDoneResponse();
            }

            return obsidianDoneResponse();
          },
        },
      );

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
        writeSuccessSummary(
          "Moved unchecked tasks from yesterday into today's routine",
          todayPath,
        ),
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("returns a notice when today already exists and the first Obsidian step still chooses create_new", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-mixed-recovery-vault-"));
    const yesterdayPath = "routine/July/July 4 - Sat.md";
    const todayPath = "routine/July/July 5 - Sun.md";
    let sawCreateNotice = false;

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, yesterdayPath),
      "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("write_file", {
                relativePath: todayPath,
                operation: "create_new",
                content: "## Today\n",
                summary: "Created today's routine note",
              }, "create-today");
            }

            if (latestMessage instanceof ToolMessage) {
              const toolContent = typeof latestMessage.content === "string"
                ? latestMessage.content
                : JSON.stringify(latestMessage.content);

              if (toolContent.includes(`Notice: File already exists at ${todayPath}.`)) {
                sawCreateNotice = true;
                return makeToolCallMessage("read_file", {
                  relativePath: yesterdayPath,
                }, "read-yesterday-after-notice");
              }

              if (toolContent.includes("- [ ] Buy milk") && !toolContent.startsWith("Success:")) {
                return makeToolCallMessage("write_file", {
                  relativePath: todayPath,
                  operation: "append",
                  content: "- [ ] Buy milk",
                  summary: "Moved unchecked tasks from yesterday into today's routine",
                }, "append-after-read");
              }

              return obsidianDoneResponse();
            }

            return obsidianDoneResponse();
          },
        },
      );

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("create a note for today, move unchecked todos from yesterday's note")],
        },
        workflowConfig,
      );

      const todayContent = await readFile(path.join(vaultRoot, todayPath), "utf8");
      const yesterdayContent = await readFile(path.join(vaultRoot, yesterdayPath), "utf8");

      expect(sawCreateNotice).toBe(true);
      expect(todayContent).toContain("## Today");
      expect(todayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [ ] Buy milk");
      expect(yesterdayContent).toContain("- [x] Archive receipt");
      expect(finalState.messages.at(-1)?.content).toBe(
        writeSuccessSummary(
          "Moved unchecked tasks from yesterday into today's routine",
          todayPath,
        ),
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("stops the Obsidian loop after the configured maximum number of tool steps", async () => {
    const loopTestAgents = buildTestRuntimeAgents().map((agent) =>
      agent.id === "obsidian" ? { ...agent, maxSteps: 3 } : agent,
    );
    const loopTestRepository = createRuntimeAgentRepositoryFake(loopTestAgents);

    const app = makeWorkflowGraph(
      createRouteSupervisor(),
      path.join(os.tmpdir(), "unused-loop-limit-vault"),
      loopTestRepository,
      loopTestAgents,
      {
        obsidian: () =>
          makeToolCallMessage("search_files", {
            queries: ["loop"],
          }, `loop-step-${Date.now()}`),
      },
    );

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("keep searching forever")],
      },
      {
        ...workflowConfig,
        recursionLimit: 40,
      },
    );

    expect(finalState.messages.at(-1)?.content).toBe(
      "Unable to edit the local markdown vault: exceeded the maximum of 3 Obsidian tool steps.",
    );
  });

  test("marks a task complete by reading then editing the note", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-task-status-vault-"));
    const notePath = "routine/July/July 5 - Sun.md";

    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(path.join(vaultRoot, notePath), "## Today\n- [ ] Go to sauna after noon\n- [ ] Review PRs\n", "utf8");

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("read_file", {
                relativePath: notePath,
              }, "read-note");
            }

            if (latestMessage instanceof ToolMessage) {
              const toolContent = typeof latestMessage.content === "string"
                ? latestMessage.content
                : JSON.stringify(latestMessage.content);

              if (toolContent.includes("- [ ] Go to sauna after noon")) {
                return makeToolCallMessage("write_file", {
                  relativePath: notePath,
                  operation: "overwrite",
                  content: "## Today\n- [x] Go to sauna after noon\n- [ ] Review PRs",
                  summary: "Marked 'Go to sauna after noon' as completed",
                }, "complete-sauna");
              }

              return obsidianDoneResponse();
            }

            return obsidianDoneResponse();
          },
        },
      );

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
        writeSuccessSummary("Marked 'Go to sauna after noon' as completed", notePath),
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("edits existing markdown content via the targeted edit tool", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-edit-note-vault-"));
    const notePath = "notes/today.md";

    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await writeFile(path.join(vaultRoot, notePath), "## Today\nPlan for today\n", "utf8");

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
              return makeToolCallMessage("read_file", {
                relativePath: notePath,
              }, "read-today");
            }

            if (latestMessage instanceof ToolMessage) {
              const toolContent = typeof latestMessage.content === "string"
                ? latestMessage.content
                : JSON.stringify(latestMessage.content);

              if (toolContent.includes("Plan for today")) {
                return makeToolCallMessage("write_file", {
                  relativePath: notePath,
                  operation: "overwrite",
                  content: "## Today\nPlan for today\n- [ ] Go to sauna after noon",
                  summary: "Updated today's note with the sauna plan",
                }, "edit-today");
              }

              return obsidianDoneResponse();
            }

            return obsidianDoneResponse();
          },
        },
      );

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
        writeSuccessSummary("Updated today's note with the sauna plan", notePath),
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("broadens search queries across multiple steps when initial search returns no results (try-fail-broaden loop)", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-search-broaden-vault-"));

    await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
    await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "notes/fitness-log.md"),
      "# Fitness Log\nJuly 5: Went to gym\nDid morning exercise routine\n",
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "routine/July/July 5 - Sun.md"),
      "## Today\nHad a meeting with team at 2pm\n",
      "utf8",
    );

    const searchReply =
      "Found your fitness log from July 5. It mentions that you went to gym and did morning exercise routine.";

    try {
      const app = makeWorkflowGraph(
        createRouteSupervisor(),
        vaultRoot,
        undefined,
        undefined,
        {
          obsidian: (input) => {
            const latestMessage = latestInputMessage(input);

            if (latestMessage instanceof HumanMessage) {
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

            if (latestMessage instanceof ToolMessage) {
              const toolContent = typeof latestMessage.content === "string"
                ? latestMessage.content
                : JSON.stringify(latestMessage.content);

              if (toolContent.includes("No files matched")) {
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

              if (toolContent.includes("fitness-log.md")) {
                return new AIMessage(searchReply);
              }
            }

            return obsidianDoneResponse();
          },
        },
      );

      const finalState = await app.invoke(
        {
          messages: [new HumanMessage("find my workout notes from July 5")],
        },
        workflowConfig,
      );

      expect(finalState.messages.at(-1)?.content).toBe(searchReply);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  test("routes a persisted runtime agent through Runtime_SG", async () => {
    const customAgents: RuntimeAgentDefinition[] = [
      {
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day in plain language.",
        systemPrompt: "You are a daily summary specialist.",
        toolBundleIds: ["none"],
        executor: "generic",
        builtin: false,
        maxSteps: 4,
        enabled: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ];
    const runtimeAgentRepository = createRuntimeAgentRepositoryFake(customAgents);

    const connector = new FakeLLMConnector(() => ({ next: "daily-summary" }));
    const app = makeWorkflowGraph(
      connector,
      path.join(os.tmpdir(), "unused-runtime-agent-vault"),
      runtimeAgentRepository,
      customAgents,
      { generic: () => new AIMessage("Here is your daily summary for today.") },
    );

    const finalState = await app.invoke(
      {
        messages: [new HumanMessage("summarize my day")],
      },
      workflowConfig,
    );

    expect(finalState.context?.runtimeAgentId).toBe("daily-summary");
    expect(finalState.messages.at(-1)?.content).toBe("Here is your daily summary for today.");
  });
});