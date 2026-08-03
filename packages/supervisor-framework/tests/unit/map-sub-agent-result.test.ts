import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { mapSubAgentResult } from "../../src/core/execution/map-sub-agent-result.js";

describe("mapSubAgentResult", () => {
  it("keeps a completed reply when stepCount equals maxSteps (default options)", () => {
    const finalReply = new AIMessage("Done.");
    const result = mapSubAgentResult(
      {
        agentMessages: [new HumanMessage("go"), finalReply],
        stepCount: 5,
      },
      { maxSteps: 5, name: "Agent" },
    );

    expect(result.messages[0]?.content).toBe("Done.");
  });

  it("reports max-steps when there is no reply and no salvage", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("go"),
          new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: {}, id: "1", type: "tool_call" }],
          }),
        ],
        stepCount: 3,
      },
      { maxSteps: 3, name: "Agent" },
    );

    expect(result.messages[0]?.content).toBe(
      "Unable to complete Agent: exceeded the maximum of 3 tool steps.",
    );
  });

  it("salvages via buildSummary before max-steps", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("list"),
          new ToolMessage({ tool_call_id: "1", content: "tool payload" }),
          new AIMessage({ content: "" }),
        ],
        stepCount: 2,
      },
      { maxSteps: 10, name: "Agent" },
      {
        buildSummary: () => "tool payload",
        emptyHandoffWhenNoSalvage: true,
      },
    );

    expect(result.messages[0]?.content).toBe("tool payload");
  });

  it("prefers successful side-effect summary over max-steps error", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("write"),
          new ToolMessage({ tool_call_id: "1", content: "Success: saved" }),
          new AIMessage({
            content: "",
            tool_calls: [{ name: "more", args: {}, id: "2", type: "tool_call" }],
          }),
        ],
        stepCount: 8,
      },
      { maxSteps: 8, name: "Agent" },
      {
        buildSummary: () => "saved note",
        completionFallback: "Completed the task.",
        isSuccessfulSideEffect: () => true,
        maxStepsMessage: "exceeded max steps",
        emptyHandoffWhenNoSalvage: true,
      },
    );

    expect(result.messages[0]?.content).toBe("saved note");
  });

  it("uses completionFallback when side-effect succeeds without summary", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("write"),
          new ToolMessage({ tool_call_id: "1", content: "Success:" }),
          new AIMessage({ content: "" }),
        ],
        stepCount: 2,
      },
      { maxSteps: 8, name: "Agent" },
      {
        completionFallback: "Completed the task.",
        isSuccessfulSideEffect: () => true,
        emptyHandoffWhenNoSalvage: true,
      },
    );

    expect(result.messages[0]?.content).toBe("Completed the task.");
  });

  it("emits empty handoff for completionFallback when emptyHandoffWhenNoSalvage", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("noop"),
          new AIMessage("Completed the task."),
        ],
        stepCount: 1,
      },
      { maxSteps: 10, name: "Agent" },
      {
        completionFallback: "Completed the task.",
        emptyHandoffWhenNoSalvage: true,
      },
    );

    expect(result.messages[0]?.content).toBe("");
  });

  it("preserves completionFallback when emptyHandoffWhenNoSalvage is off", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("noop"),
          new AIMessage("Completed the task."),
        ],
        stepCount: 1,
      },
      { maxSteps: 10, name: "Agent" },
      {
        completionFallback: "Completed the task.",
      },
    );

    expect(result.messages[0]?.content).toBe("Completed the task.");
  });

  it("returns empty handoff when emptyHandoffWhenNoSalvage and blank last", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("go"),
          new AIMessage({ content: "" }),
        ],
        stepCount: 1,
      },
      { maxSteps: 10, name: "Agent" },
      {
        emptyHandoffWhenNoSalvage: true,
      },
    );

    expect(result.messages[0]?.content).toBe("");
  });

  it("passes through last message for default/finance when no salvage flags", () => {
    const last = new AIMessage({ content: "" });
    const result = mapSubAgentResult(
      {
        agentMessages: [new HumanMessage("go"), last],
        stepCount: 1,
      },
      { maxSteps: 10, name: "Agent" },
    );

    expect(result.messages[0]).toBe(last);
  });

  it("uses custom maxStepsMessage string", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("go"),
          new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: {}, id: "1", type: "tool_call" }],
          }),
        ],
        stepCount: 2,
      },
      { maxSteps: 2, name: "Finance" },
      { maxStepsMessage: "custom max steps" },
    );

    expect(result.messages[0]?.content).toBe("custom max steps");
  });

  it("resolves maxStepsMessage from a function", () => {
    const result = mapSubAgentResult(
      {
        agentMessages: [
          new HumanMessage("go"),
          new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: {}, id: "1", type: "tool_call" }],
          }),
        ],
        stepCount: 4,
      },
      { maxSteps: 4, name: "Obsidian" },
      {
        maxStepsMessage: ({ maxSteps }) => `vault exceeded ${maxSteps}`,
      },
    );

    expect(result.messages[0]?.content).toBe("vault exceeded 4");
  });
});
