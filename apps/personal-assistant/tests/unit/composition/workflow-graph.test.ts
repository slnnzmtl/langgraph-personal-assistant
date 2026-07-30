import { AIMessage, HumanMessage } from "@langchain/core/messages";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildCronTriggerForJob, createCronJobRepository } from "@personal-assistant/supervisor-framework";
import { defaultTestCronTargetAgentIds } from "../../helpers/runtime-agent-fixtures.js";
import type { SqlSession } from "../../../src/ports/sql-session.js";
import { FakeLLMConnector, createRuntimeAgentRepositoryFake, makeTestRuntimeAgent } from "../../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../../helpers/runtime-agent-fixtures.js";
import { createTestWorkflowGraph } from "../../helpers/workflow-graph.js";

const threadConfig = { configurable: { thread_id: "unit-test-thread" } };

const latestHumanInputText = (input: unknown): string => {
  if (!Array.isArray(input)) {
    return "";
  }

  for (let index = input.length - 1; index >= 0; index -= 1) {
    const message = input[index];
    if (message instanceof HumanMessage || message?._getType?.() === "human") {
      return String(message.content ?? "");
    }
  }

  return "";
};

const routeOnceThenFinish = (route: string, finishReply?: string, delegationPrompt?: string) => {
  let calls = 0;

  return () => {
    calls += 1;

    if (calls === 1) {
      return {
        next: route,
        prompt: delegationPrompt ?? `Handle the ${route} request.`,
      };
    }

    return {
      next: "FINISH",
      reply: finishReply ?? "Done",
    };
  };
};

const makeCronJobsFilePath = () => path.join(process.cwd(), ".tmp", `workflow-graph-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

const makeGraph = (
  supervisorHandler: (input: unknown) => unknown,
  obsidianHandler?: (input: unknown) => unknown,
  financeHandler?: (input: unknown) => unknown,
  sqlSession?: SqlSession,
  configHandler?: (input: unknown) => unknown,
  runtimeAgentRepository = createRuntimeAgentRepositoryFake(),
  runtimeAgents?: ReturnType<typeof buildTestRuntimeAgents>,
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
    runtimeAgents: runtimeAgents ?? buildTestRuntimeAgents(),
    obsidianVaultPath: path.join(os.tmpdir(), "pa-unit-vault"),
    cronJobRepository: createCronJobRepository(
      process.cwd(),
      path.relative(process.cwd(), makeCronJobsFilePath()),
      defaultTestCronTargetAgentIds(),
    ),
    runtimeAgentRepository,
    ...(sqlSession
      ? {
          supabaseReadSession: sqlSession,
          supabaseWriteSession: sqlSession,
        }
      : {}),
  });

describe("supervisor graph compilation", () => {
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

  it("rejects finance routing when Supabase is unavailable", async () => {
    let calls = 0;
    const app = makeGraph((input) => {
      calls += 1;

      if (Array.isArray(input) && String(input[0]?.content).includes("Unknown or disabled runtime agent route")) {
        return new AIMessage("Finance is unavailable in this deployment.");
      }

      return { next: "finance", prompt: "Show finances." };
    });

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    expect(calls).toBe(2);
    expect(state.messages.at(-1)?.content).toContain("Finance is unavailable");
  });

  it("visits the finance node on finance route (real integration with mock session)", async () => {
    const mockSession: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };

    let calls = 0;
    const supervisorHandler = routeOnceThenFinish(
      "finance",
      "Finance sync completed successfully",
    );
    const app = makeGraph(
      () => {
        calls += 1;
        return supervisorHandler();
      },
      undefined,
      undefined,
      mockSession,
    );

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    expect(calls).toBe(2);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed");
  });

  it("preserves every finance tool result when the model emits parallel tool calls", async () => {
    const mockSession: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };
    let financeCalls = 0;
    const app = makeGraph(
      routeOnceThenFinish("finance", "Finance sync completed successfully"),
      undefined,
      (input) => {
        financeCalls += 1;

        if (financeCalls === 1) {
          return new AIMessage({
            content: "",
            tool_calls: [{
              name: "read_skill",
              args: { name: "sync-expenses" },
              id: "read-sync-expenses",
              type: "tool_call" as const,
            }],
          });
        }

        if (financeCalls === 2) {
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

        const toolResults = (input as Array<{ _getType?: () => string; tool_call_id?: string }>).filter(
          (message) => message._getType?.() === "tool",
        );
        const execSqlResults = toolResults.filter(
          (message: { tool_call_id?: string }) => message.tool_call_id?.startsWith("finance-tool-"),
        );
        expect(execSqlResults).toHaveLength(6);
        expect(execSqlResults.map((message: { tool_call_id: string }) => message.tool_call_id)).toEqual(
          Array.from({ length: 6 }, (_, index) => `finance-tool-${index + 1}`),
        );

        return new AIMessage("Finance sync completed successfully");
      },
      mockSession,
    );

    const state = await app.invoke({ messages: [new HumanMessage("sync yesterday's transactions")] }, threadConfig);

    expect(financeCalls).toBe(3);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed");
  });

  it("visits the obsidian node on obsidian route", async () => {
    let supervisorCalls = 0;
    const supervisorHandler = routeOnceThenFinish("obsidian", "obsidian result");
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return supervisorHandler();
      },
      () => new AIMessage("obsidian result"),
    );

    const state = await app.invoke({ messages: [new HumanMessage("write a note")] }, threadConfig);

    expect(supervisorCalls).toBe(2);
    expect(state.messages.at(-1)?.content).toBe("obsidian result");
  });

  it("visits the configuration node on configuration route", async () => {
    let supervisorCalls = 0;
    const supervisorHandler = routeOnceThenFinish(
      "configuration",
      "Cron configuration is not implemented yet, but this route is now reserved for chat-driven cron setup.",
    );
    const app = makeGraph(() => {
      supervisorCalls += 1;
      return supervisorHandler();
    });

    const state = await app.invoke({ messages: [new HumanMessage("schedule a daily reminder")] }, threadConfig);

    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Cron configuration");
  });

  it("executes config tool calls before returning to the supervisor", async () => {
    let supervisorCalls = 0;
    let configCalls = 0;
    const supervisorHandler = routeOnceThenFinish("configuration", "Created cron job daily-note.");
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return supervisorHandler();
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

  it("executes a multi-agent queue sequentially before re-planning", async () => {
    const mockSession: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };
    let supervisorCalls = 0;
    let financeCalls = 0;
    let obsidianCalls = 0;
    let financeInput = "";
    let obsidianInput = "";
    const app = makeGraph(
      () => {
        supervisorCalls += 1;

        if (supervisorCalls === 1) {
          return {
            next: "finance",
            queue: [
              { agentId: "finance", prompt: "Show yesterday's expenses." },
              { agentId: "obsidian", prompt: "Show today's plan." },
            ],
          };
        }

        return { next: "FINISH", reply: "Finance synced and note written." };
      },
      (input) => {
        obsidianCalls += 1;
        obsidianInput = latestHumanInputText(input);
        return new AIMessage("obsidian note saved");
      },
      (input) => {
        financeCalls += 1;
        financeInput = latestHumanInputText(input);
        return new AIMessage("Finance sync completed successfully");
      },
      mockSession,
    );

    const state = await app.invoke(
      { messages: [new HumanMessage("show me today's plan and yesterday expenses")] },
      threadConfig,
    );

    expect(supervisorCalls).toBe(2);
    expect(financeCalls).toBe(1);
    expect(obsidianCalls).toBe(1);
    expect(financeInput).toBe("Show yesterday's expenses.");
    expect(obsidianInput).toBe("Show today's plan.");
    expect(financeInput).not.toContain("today's plan");
    expect(obsidianInput).not.toContain("yesterday expenses");
    expect(state.messages.some((message) => String(message.content).includes("Finance sync completed"))).toBe(true);
    expect(state.messages.some((message) => String(message.content).includes("obsidian note saved"))).toBe(true);
    expect(state.messages.at(-1)?.content).toBe("Finance synced and note written.");
  });

  it("routes scheduled finance triggers to the finance node without supervisor LLM routing", async () => {
    const mockSession: SqlSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };
    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "FINISH", reply: "Finance sync completed successfully" };
      },
      undefined,
      () => new AIMessage("Finance sync completed successfully"),
      mockSession,
    );

    const state = await app.invoke(
      { messages: [new HumanMessage(buildCronTriggerForJob("finance", "finance-sync"))] },
      threadConfig,
    );

    expect(supervisorCalls).toBe(1);
    expect(state.messages.some((message) => String(message.content).includes("Finance sync completed successfully"))).toBe(true);
  });

  it("routes to a runtime agent when the supervisor selects a custom agent id", async () => {
    const customAgents = [
      ...buildTestRuntimeAgents(),
      makeTestRuntimeAgent({
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day in plain language.",
        systemPrompt: "You are a daily summary specialist.",
        capabilityIds: ["none"],
        maxSteps: 4,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    ];
    const runtimeAgentRepository = createRuntimeAgentRepositoryFake(customAgents);

    let supervisorCalls = 0;
    const supervisorHandler = routeOnceThenFinish("daily-summary", "Here is your daily summary.");
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return supervisorHandler();
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

    expect(supervisorCalls).toBe(2);
    expect(state.context?.runtimeAgentId).toBe("daily-summary");
    expect(state.messages.at(-1)?.content).toContain("daily summary");
  });
});
