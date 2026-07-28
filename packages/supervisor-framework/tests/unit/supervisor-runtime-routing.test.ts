import { describe, expect, it } from "vitest";

import {
  createTestSupervisorNode,
  createRuntimeAgentRepositoryFake,
  makeHumanState,
  makeTestRuntimeAgent,
  buildTestRuntimeAgents,
  getStateUpdateRuntimeAgentId,
} from "../helpers/supervisor-node-fixtures.js";
import { FakeLLMConnector } from "../helpers/fakes.js";
import { FAILURE_REPLY_ROUTE } from "../../src/index.js";

describe("supervisor runtime routing", () => {
  it("maps a runtime agent id to the agent route and stores the selection in context", async () => {
    const repository = createRuntimeAgentRepositoryFake([
      ...buildTestRuntimeAgents(),
      makeTestRuntimeAgent({
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day.",
        systemPrompt: "You summarize days.",
        capabilityIds: ["none"],
        maxSteps: 4,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    ]);

    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({ next: "daily-summary", prompt: "Summarize my day." })),
      {
        runtimeAgentRepository: repository,
        wiredAgentIds: new Set(["finance", "obsidian", "configuration", "daily-summary"]),
      },
    );

    const result = await supervisorNode(makeHumanState("summarize my day"));

    expect(result.next).toBe("daily-summary");
    expect(result.delegationPrompt).toBe("Summarize my day.");
    expect(getStateUpdateRuntimeAgentId(result)).toBe("daily-summary");
  });

  it("routes unknown runtime agent ids to failure_reply", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({ next: "missing-agent", prompt: "Do something." })),
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
      makeTestRuntimeAgent({
        id: "unwired-agent",
        name: "Unwired Agent",
        description: "Persisted but not compiled.",
        systemPrompt: "You are unwired.",
        capabilityIds: ["none"],
        maxSteps: 4,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    ]);

    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({ next: "unwired-agent", prompt: "Use the unwired agent." })),
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

  it("routes invalid queue members to failure_reply", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({
        next: "finance",
        queue: [
          { agentId: "finance", prompt: "Sync expenses." },
          { agentId: "missing-agent", prompt: "Summarize results." },
        ],
      })),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("sync then summarize"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("missing-agent");
    expect(result.executionQueue).toEqual([]);
  });

  it("routes missing single-agent prompts to failure_reply", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({ next: "finance" })),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result.next).toBe(FAILURE_REPLY_ROUTE);
    expect(result.routingFailureContext).toContain("Missing delegation prompt");
  });

  it("still routes a single next value with prompt as a one-item plan", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createTestSupervisorNode(
      new FakeLLMConnector(() => ({ next: "finance", prompt: "Log lunch expense." })),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result.next).toBe("finance");
    expect(result.delegationPrompt).toBe("Log lunch expense.");
    expect(result.executionQueue).toEqual([]);
    expect(getStateUpdateRuntimeAgentId(result)).toBe("finance");
  });
});
