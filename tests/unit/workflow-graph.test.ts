import { AIMessage, HumanMessage } from "@langchain/core/messages";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createWorkflowGraph } from "../../src/graph/workflow-graph.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const threadConfig = { configurable: { thread_id: "unit-test-thread" } };

const makeGraph = (supervisorHandler: (input: any) => any, obsidianHandler?: (input: any) => any) =>
  createWorkflowGraph(
    new FakeLLMConnector(supervisorHandler),
    new FakeLLMConnector(obsidianHandler ?? (() => new AIMessage("obsidian done"))),
    { obsidianVaultPath: path.join(os.tmpdir(), "pa-unit-vault"), appTimezone: "UTC" },
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

  it("visits the finance node on Finance_SG route", async () => {
    let calls = 0;
    const app = makeGraph(() => {
      calls += 1;
      return { next: "Finance_SG" };
    });

    const state = await app.invoke({ messages: [new HumanMessage("show finances")] }, threadConfig);

    // Supervisor routes once; finance mock runs; supervisor then auto-FINISHes via isSubAgentComplete
    expect(calls).toBe(1);
    expect(state.messages.at(-1)?.content).toContain("Mock Finance Sub-Graph Executed");
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
