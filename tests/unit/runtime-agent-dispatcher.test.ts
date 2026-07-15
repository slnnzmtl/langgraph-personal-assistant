import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createRuntimeAgentDispatcher } from "../../src/runtime-agents/dispatch.js";
import { RUNTIME_AGENT_CONTEXT_KEY } from "../../src/runtime-agents/types.js";
import {
  FakeLLMConnector,
  createRuntimeAgentRepositoryFake,
  createRuntimeExecutionContextFake,
} from "../helpers/fakes.js";

describe("createRuntimeAgentDispatcher", () => {
  it("rejects dispatch when no runtime agent id is present in context", async () => {
    const dispatcher = createRuntimeAgentDispatcher(createRuntimeExecutionContextFake());

    const result = await dispatcher({
      messages: [new HumanMessage("hello")],
      context: {},
      next: "Runtime_SG",
    });

    expect(result.messages?.[0]?.content).toContain("No runtime agent was selected");
  });

  it("rejects disabled runtime agents", async () => {
    const repository = createRuntimeAgentRepositoryFake([
      {
        id: "daily-summary",
        name: "Daily Summary",
        description: "Summarize the user's day.",
        systemPrompt: "You summarize days.",
        toolBundleIds: ["none"],
        executor: "generic",
        maxSteps: 4,
        enabled: false,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ]);

    const dispatcher = createRuntimeAgentDispatcher(createRuntimeExecutionContextFake({
      repository,
      llmConnector: new FakeLLMConnector(() => new AIMessage("unused")),
    }));

    const result = await dispatcher({
      messages: [new HumanMessage("hello")],
      context: { [RUNTIME_AGENT_CONTEXT_KEY]: "daily-summary" },
      next: "Runtime_SG",
    });

    expect(result.messages?.[0]?.content).toContain("disabled");
  });

  it("invokes a prompt-only runtime agent and returns its final reply", async () => {
    const repository = createRuntimeAgentRepositoryFake([
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

    const dispatcher = createRuntimeAgentDispatcher(createRuntimeExecutionContextFake({
      repository,
      llmConnector: new FakeLLMConnector(() => new AIMessage("Here is your daily summary.")),
    }));

    const result = await dispatcher({
      messages: [new HumanMessage("summarize my day")],
      context: { [RUNTIME_AGENT_CONTEXT_KEY]: "daily-summary" },
      next: "Runtime_SG",
    });

    expect(result.messages?.[0]?.content).toContain("daily summary");
  });
});
