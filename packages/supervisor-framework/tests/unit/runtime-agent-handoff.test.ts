import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { buildRuntimeAgentHandoff } from "../../src/core/execution/runtime-agent-handoff.js";

describe("runtime agent handoff protocol", () => {
  it("builds structured handoff metadata for finalized agent replies", () => {
    const handoff = buildRuntimeAgentHandoff({
      agentId: "finance",
      agentName: "Finance",
      message: new AIMessage("Done."),
      agentMessages: [new AIMessage("Done.")],
      stepCount: 2,
      maxSteps: 10,
      delegationPrompt: "Sync expenses.",
    });

    expect(handoff).toEqual({
      kind: "runtime-agent-handoff",
      agentId: "finance",
      agentName: "Finance",
      status: "ok",
      delegationPrompt: "Sync expenses.",
    });
  });

  it("includes tool context on ok handoffs when the final reply is empty", () => {
    const handoff = buildRuntimeAgentHandoff({
      agentId: "finance",
      agentName: "Finance",
      message: new AIMessage({
        content: "",
        tool_calls: [{ id: "1", name: "fetch_wise_transactions", args: {} }],
      }),
      agentMessages: [
        new AIMessage({ content: "", tool_calls: [{ id: "1", name: "fetch_wise_transactions", args: {} }] }),
        new ToolMessage({
          content: "Fetched and normalized 5 Wise transactions",
          tool_call_id: "1",
          name: "fetch_wise_transactions",
        }),
        new AIMessage({
          content: "",
          tool_calls: [{ id: "2", name: "exec_sql", args: {} }],
        }),
      ],
      stepCount: 2,
      maxSteps: 10,
    });

    expect(handoff.status).toBe("ok");
    expect(handoff.toolContext).toContain("fetch_wise_transactions:");
    expect(handoff.toolContext).toContain("Fetched and normalized 5 Wise transactions");
  });

  it("marks explicit error status from runtime agent failures", () => {
    const handoff = buildRuntimeAgentHandoff({
      agentId: "finance",
      agentName: "Finance",
      message: new AIMessage("Unable to run runtime agent Finance: timeout"),
      agentMessages: [new AIMessage("Unable to run runtime agent Finance: timeout")],
      stepCount: 1,
      maxSteps: 10,
      explicitStatus: "error",
    });

    expect(handoff.status).toBe("error");
  });

  it("marks tool-surfaced Error results as error without explicit status", () => {
    const handoff = buildRuntimeAgentHandoff({
      agentId: "configuration",
      agentName: "Configuration",
      message: new AIMessage("I cannot create the agent because the capability is invalid."),
      agentMessages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "1", name: "create_runtime_agent", args: {} }],
        }),
        new ToolMessage({
          tool_call_id: "1",
          name: "create_runtime_agent",
          content: "Error: Unknown capability: fitness-domain",
        }),
        new AIMessage("I cannot create the agent because the capability is invalid."),
      ],
      stepCount: 2,
      maxSteps: 10,
    });

    expect(handoff.status).toBe("error");
  });
});
