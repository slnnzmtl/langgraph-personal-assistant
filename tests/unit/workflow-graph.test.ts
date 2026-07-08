import { AIMessage, HumanMessage } from "@langchain/core/messages";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildSchedulerTrigger } from "../../src/cron/scheduler-trigger.js";
import { createWorkflowGraph } from "../../src/graph/workflow-graph.js";
import type { SupabaseMcpSession } from "../../src/packages/finance-server/src/index.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const threadConfig = { configurable: { thread_id: "unit-test-thread" } };

const makeCronJobsFilePath = () => path.join(process.cwd(), ".tmp", `workflow-graph-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

const makeGraph = (
  supervisorHandler: (input: any) => any,
  obsidianHandler?: (input: any) => any,
  financeHandler?: (input: any) => any,
  supabaseSession?: SupabaseMcpSession,
  configHandler?: (input: any) => any,
) =>
  createWorkflowGraph(
    new FakeLLMConnector(supervisorHandler),
    new FakeLLMConnector(obsidianHandler ?? (() => new AIMessage("obsidian done"))),
    new FakeLLMConnector(financeHandler ?? (() => new AIMessage("Finance sync completed successfully"))),
    new FakeLLMConnector(configHandler ?? (() => new AIMessage("Cron configuration is not implemented yet, but this route is now reserved for chat-driven scheduler setup."))),
    {
      obsidianVaultPath: path.join(os.tmpdir(), "pa-unit-vault"),
      appTimezone: "UTC",
      cronJobsFilePath: makeCronJobsFilePath(),
      supabaseSession,
    },
  );

describe("createWorkflowGraph", () => {
  it("compiles without throwing", () => {
    expect(() => makeGraph(() => ({ next: "FINISH", reply: "ok" }))).not.toThrow();
  });

  it("returns the supervisor reply directly on FINISH route", async () => {
    const app = makeGraph(() => ({ next: "FINISH", reply: "Direct answer" }));

    const state = await app.invoke({ messages: [new HumanMessage("hi")] }, threadConfig);

    expect(state.messages.at(-1)?.content).toBe("Direct answer");
  });

  it("visits the finance node on Finance_SG route (fallback when no repository)", async () => {
    let calls = 0;
    const app = makeGraph(() => {
      calls += 1;
      return { next: "Finance_SG" };
    });

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    // Supervisor routes once; finance fallback runs; supervisor then auto-FINISHes via isSubAgentComplete
    expect(calls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Finance sync not configured");
  });

  it("visits the finance node on Finance_SG route (real integration with mock session)", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
    };

    let calls = 0;
    const app = makeGraph(
      () => {
        calls += 1;
        return { next: "Finance_SG" };
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

  it("visits the obsidian node on Obsidian_SG route", async () => {
    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "Obsidian_SG" };
      },
      () => new AIMessage("obsidian result"),
    );

    const state = await app.invoke({ messages: [new HumanMessage("write a note")] }, threadConfig);

    // Supervisor routes once; obsidian runs; supervisor then auto-FINISHes via isSubAgentComplete
    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toBe("obsidian result");
  });

  it("visits the configuration node on Config_SG route", async () => {
    let supervisorCalls = 0;
    const app = makeGraph(() => {
      supervisorCalls += 1;
      return { next: "Config_SG" };
    });

    const state = await app.invoke({ messages: [new HumanMessage("schedule a daily reminder")] }, threadConfig);

    expect(supervisorCalls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Cron configuration");
  });

  it("executes config tool calls before returning to the supervisor", async () => {
    let supervisorCalls = 0;
    const app = makeGraph(
      () => {
        supervisorCalls += 1;
        return { next: "Config_SG" };
      },
      undefined,
      undefined,
      undefined,
      () => new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "create_cron_job",
            args: {
              jobName: "daily-note",
              schedule: "0 6 * * *",
              targetRoute: "Obsidian_SG",
              payload: "Create my daily note",
            },
            id: "config-tool-1",
            type: "tool_call",
          },
        ],
      }),
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
      { messages: [new HumanMessage(buildSchedulerTrigger("finance-sync"))] },
      threadConfig,
    );

    expect(supervisorCalls).toBe(0);
    expect(state.messages.at(-1)?.content).toContain("Finance sync completed successfully");
  });
});
