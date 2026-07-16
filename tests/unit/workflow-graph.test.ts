import { AIMessage, HumanMessage } from "@langchain/core/messages";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildCronTriggerForJob } from "../../src/cron-triggers.js";
import { createCronJobRepository } from "../../src/cron/cron-job-repository.js";
import { defaultCronTargetAgentIds } from "../../src/app/runtime-agent-catalog.js";
import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import { FakeLLMConnector, createRuntimeAgentRepositoryFake } from "../helpers/fakes.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/defaults.js";
import { createTestWorkflowGraph } from "../helpers/workflow-graph.js";

const threadConfig = { configurable: { thread_id: "unit-test-thread" } };

const makeCronJobsFilePath = () => path.join(process.cwd(), ".tmp", `workflow-graph-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

const makeGraph = (
  supervisorHandler: (input: unknown) => unknown,
  obsidianHandler?: (input: unknown) => unknown,
  financeHandler?: (input: unknown) => unknown,
  supabaseSession?: SupabaseMcpSession,
  configHandler?: (input: unknown) => unknown,
  runtimeAgentRepository = createRuntimeAgentRepositoryFake(),
  runtimeAgents?: ReturnType<typeof buildDefaultRuntimeAgents>,
  modelHandlerOverrides?: Record<string, (input: unknown) => unknown>,
) =>
  createTestWorkflowGraph({
    supervisorLlm: new FakeLLMConnector(supervisorHandler),
    modelHandlers: {
      generic: modelHandlerOverrides?.generic ?? (() => new AIMessage("ok")),
      obsidian: obsidianHandler ?? modelHandlerOverrides?.obsidian ?? (() => new AIMessage("obsidian done")),
      finance: financeHandler ?? modelHandlerOverrides?.finance ?? (() => new AIMessage("Finance sync completed successfully")),
      configuration: configHandler ?? modelHandlerOverrides?.configuration ?? (() => new AIMessage("Cron configuration is not implemented yet, but this route is now reserved for chat-driven cron setup.")),
    },
    runtimeAgents: runtimeAgents ?? buildDefaultRuntimeAgents(),
    obsidianVaultPath: path.join(os.tmpdir(), "pa-unit-vault"),
    cronJobRepository: createCronJobRepository(
      process.cwd(),
      path.relative(process.cwd(), makeCronJobsFilePath()),
      defaultCronTargetAgentIds(),
    ),
    runtimeAgentRepository,
    ...(supabaseSession ? { supabaseSession } : {}),
  });

describe("createWorkflowGraph", () => {
  it("compiles without throwing", () => {
    expect(() => makeGraph(() => ({ next: "FINISH", reply: "ok" }))).not.toThrow();
  });

  it("returns the supervisor reply directly on FINISH route", async () => {
    const app = makeGraph(() => ({ next: "FINISH", reply: "Direct answer" }));

    const state = await app.invoke({ messages: [new HumanMessage("hi")] }, threadConfig);

    expect(state.messages.at(-1)?.content).toBe("Direct answer");
  });

  it("recovers from an incomplete FINISH route for a time question in a threaded conversation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:34:56.000Z"));

    const app = makeGraph((input) => {
      if (Array.isArray(input)) {
        const systemContent = typeof input[0]?.content === "string" ? input[0].content : "";

        if (systemContent.includes("The normal supervisor routing failed")) {
          return new AIMessage("It is currently 2026-07-05T12:34:56 UTC.");
        }

        return { next: "FINISH" };
      }

      return { next: "FINISH" };
    });

    const state = await app.invoke(
      {
        messages: [
          new HumanMessage("list yesterday's expenses"),
          new AIMessage("Here are yesterday's expenses:\n\n* Grab: 7 USD - Food\n* Grab: 7 USD - Food"),
          new HumanMessage("give todays"),
          new AIMessage("Here are today's expenses:\n\n* Moonmilk: 1 USD - Shop\n* Grab: 21 USD - Food"),
          new HumanMessage("what time is it"),
        ],
      },
      threadConfig,
    );

    expect(state.messages.at(-1)?.content).toBe("It is currently 2026-07-05T12:34:56 UTC.");
    vi.useRealTimers();
  });

  it("visits the finance node on finance route (fallback when no repository)", async () => {
    let calls = 0;
    const app = makeGraph(() => {
      calls += 1;
      return { next: "finance" };
    });

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    // Supervisor routes once; finance fallback runs; supervisor then auto-FINISHes via isSubAgentComplete
    expect(calls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Supabase session is not configured.");
  });

  it("visits the finance node on finance route (real integration with mock session)", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };

    let calls = 0;
    const app = makeGraph(
      () => {
        calls += 1;
        return { next: "finance" };
      },
      undefined,
      undefined,
      mockSession,
    );

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    // Supervisor routes once; finance runs with mock session; supervisor then auto-FINISHes
    expect(calls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed");
    // Note: executeSql may or may not be called depending on what the LLM decides to do
    // The LLM has access to the session but chooses when to invoke tools
  });

  it("preserves every finance tool result when the model emits a six-call batch", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };
    let financeCalls = 0;
    const app = makeGraph(
      () => ({ next: "finance" }),
      undefined,
      (input) => {
        financeCalls += 1;

        if (financeCalls === 1) {
          return new AIMessage({
            content: "",
            tool_calls: Array.from({ length: 6 }, (_, index) => ({
              name: "exec_sql",
              args: { sql: `SELECT ${index + 1};` },
              id: `finance-tool-${index + 1}`,
              type: "tool_call" as const,
            })),
          });
        }

        const toolResults = input.filter((message: { _getType?: () => string }) => message._getType?.() === "tool");
        expect(toolResults).toHaveLength(6);
        expect(toolResults.map((message: { tool_call_id: string }) => message.tool_call_id)).toEqual(
          Array.from({ length: 6 }, (_, index) => `finance-tool-${index + 1}`),
        );

        return new AIMessage("Finance sync completed successfully");
      },
      mockSession,
    );

    const state = await app.invoke({ messages: [new HumanMessage("sync yesterday's transactions")] }, threadConfig);

    expect(financeCalls).toBe(2);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed");
  });

  it("visits the obsidian node on obsidian route", async () => {
    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "obsidian" };
      },
      () => new AIMessage("obsidian result"),
    );

    const state = await app.invoke({ messages: [new HumanMessage("write a note")] }, threadConfig);

    // Supervisor routes once; obsidian runs; supervisor then auto-FINISHes via isSubAgentComplete
    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toBe("obsidian result");
  });

  it("visits the configuration node on configuration route", async () => {
    let supervisorCalls = 0;
    const app = makeGraph(() => {
      supervisorCalls += 1;
      return { next: "configuration" };
    });

    const state = await app.invoke({ messages: [new HumanMessage("schedule a daily reminder")] }, threadConfig);

    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Cron configuration");
  });

  it("executes config tool calls before returning to the supervisor", async () => {
    let supervisorCalls = 0;
    let configCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "configuration" };
      },
      undefined,
      undefined,
      undefined,
      () => {
        configCalls += 1;

        if (configCalls === 1) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "read_skill",
                args: { name: "cron" },
                id: "read-1",
                type: "tool_call",
              },
            ],
          });
        }

        if (configCalls === 2) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "create_cron_job",
                args: {
                  jobName: "daily-note",
                  schedule: "0 6 * * *",
                  targetRoute: "obsidian",
                  payload: "Create my daily note",
                },
                id: "config-tool-1",
                type: "tool_call",
              },
            ],
          });
        }

        return new AIMessage("Created cron job daily-note.");
      },
    );

    const state = await app.invoke({ messages: [new HumanMessage("set up a cron job for daily notes")] }, threadConfig);

    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Created cron job");
  });

  it("routes scheduled finance triggers to the finance node without supervisor LLM routing", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };
    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "FINISH", reply: "LLM should not route scheduled triggers" };
      },
      undefined,
      () => new AIMessage("Finance sync completed successfully"),
      mockSession,
    );

    const state = await app.invoke(
      { messages: [new HumanMessage(buildCronTriggerForJob("finance", "finance-sync"))] },
      threadConfig,
    );

    expect(supervisorCalls).toBe(0);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed successfully");
  });

  it("routes to a runtime agent through Runtime_SG when the supervisor selects a custom agent id", async () => {
    const customAgents = [
      ...buildDefaultRuntimeAgents(),
      {
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day in plain language.",
        systemPrompt: "You are a daily summary specialist.",
        toolBundleIds: ["none"] as const,
        executor: "generic",
        maxSteps: 4,
        enabled: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ];
    const runtimeAgentRepository = createRuntimeAgentRepositoryFake(customAgents);

    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "daily-summary" };
      },
      undefined,
      undefined,
      undefined,
      undefined,
      runtimeAgentRepository,
      customAgents,
      {
        generic: () => new AIMessage("Here is your daily summary."),
      },
    );

    const state = await app.invoke({ messages: [new HumanMessage("summarize my day")] }, threadConfig);

    expect(supervisorCalls).toBe(1);
    expect(state.context?.runtimeAgentId).toBe("daily-summary");
    expect(state.messages.at(-1)?.content).toContain("daily summary");
  });
});
