import { AIMessage, HumanMessage } from "@langchain/core/messages";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowGraph } from "../../src/graph/workflow-graph.js";
import type { SupabaseMcpSession } from "../../src/packages/finance-server/src/index.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const threadConfig = { configurable: { thread_id: "unit-test-thread" } };

const makeGraph = (supervisorHandler: (input: any) => any, obsidianHandler?: (input: any) => any, financeHandler?: (input: any) => any, supabaseSession?: SupabaseMcpSession) =>
  createWorkflowGraph(
    new FakeLLMConnector(supervisorHandler),
    new FakeLLMConnector(obsidianHandler ?? (() => new AIMessage("obsidian done"))),
    new FakeLLMConnector(financeHandler ?? (() => new AIMessage("Finance sync completed successfully"))),
    { obsidianVaultPath: path.join(os.tmpdir(), "pa-unit-vault"), appTimezone: "UTC", supabaseSession },
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
});
