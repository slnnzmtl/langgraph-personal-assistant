import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createAppSupervisorNode, FakeLLMConnector, createRuntimeAgentRepositoryFake, makeHumanState } from "../helpers/fakes.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../../src/core/types/agent.js";

describe("supervisor runtime routing", () => {
  it("maps a runtime agent id to Runtime_SG and stores the selection in context", async () => {
    const repository = createRuntimeAgentRepositoryFake([
      ...buildTestRuntimeAgents(),
      {
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day.",
        systemPrompt: "You summarize days.",
        toolBundleIds: ["none"],
        executor: "generic",
        maxSteps: 4,
        enabled: true,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ]);

    const supervisorNode = createAppSupervisorNode(
      new FakeLLMConnector(() => ({ next: "daily-summary" })),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("summarize my day"));

    expect(result.next).toBe("Runtime_SG");
    expect(result.context?.[RUNTIME_AGENT_CONTEXT_KEY]).toBe("daily-summary");
  });

  it("rejects unknown runtime agent ids with a FINISH fallback reply", async () => {
    const repository = createRuntimeAgentRepositoryFake();
    const supervisorNode = createAppSupervisorNode(
      new FakeLLMConnector((input) => {
        if (Array.isArray(input) && String(input[0]?.content).includes("Unknown or disabled runtime agent route")) {
          return new AIMessage("That runtime agent is unavailable.");
        }

        return { next: "missing-agent" };
      }),
      { runtimeAgentRepository: repository },
    );

    const result = await supervisorNode(makeHumanState("use missing agent"));

    expect(result.next).toBe("FINISH");
    expect(result.messages?.[0]?.content).toContain("unavailable");
  });
});
