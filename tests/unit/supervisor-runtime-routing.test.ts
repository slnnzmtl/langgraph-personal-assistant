import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createAppSupervisorNode, FakeLLMConnector, createRuntimeAgentRepositoryFake, makeHumanState } from "../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../../src/core/types/agent.js";
import { FAILURE_REPLY_ROUTE } from "../../src/core/state.js";

describe("supervisor runtime routing", () => {
  it("maps a runtime agent id to the agent route and stores the selection in context", async () => {
    const repository = createRuntimeAgentRepositoryFake([
      ...buildTestRuntimeAgents(),
      {
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day.",
        systemPrompt: "You summarize days.",
        capabilityIds: ["none"],
        executor: "generic",
        maxSteps: 4,
        enabled: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ]);

    const supervisorNode = createAppSupervisorNode(
      new FakeLLMConnector(() => ({ next: "daily-summary" })),
      {
        runtimeAgentRepository: repository,
        wiredAgentIds: new Set(["finance", "obsidian", "configuration", "daily-summary"]),
      },
    );

    const result = await supervisorNode(makeHumanState("summarize my day"));

    expect(result.next).toBe("daily-summary");
    expect(result.context?.[RUNTIME_AGENT_CONTEXT_KEY]).toBe("daily-summary");
  });

  it("routes unknown runtime agent ids to failure_reply", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createAppSupervisorNode(
      new FakeLLMConnector(() => ({ next: "missing-agent" })),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("use missing agent"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("missing-agent");
    expect(result.messages).toBeUndefined();
  });

  it("routes unwired enabled agents to failure_reply", async () => {
    const repository = createRuntimeAgentRepositoryFake([
      ...buildTestRuntimeAgents(),
      {
        id: "unwired-agent",
        name: "Unwired Agent",
        description: "Persisted but not compiled.",
        systemPrompt: "You are unwired.",
        capabilityIds: ["none"],
        executor: "generic",
        maxSteps: 4,
        enabled: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ]);

    const supervisorNode = createAppSupervisorNode(
      new FakeLLMConnector(() => ({ next: "unwired-agent" })),
      {
        runtimeAgentRepository: repository,
        wiredAgentIds: new Set(["finance", "obsidian", "configuration"]),
      },
    );

    const result = await supervisorNode(makeHumanState("use unwired agent"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("unwired-agent");
    expect(result.messages).toBeUndefined();
  });
});
