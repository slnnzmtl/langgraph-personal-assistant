import { AIMessage } from "@langchain/core/messages";
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
    });

    expect(handoff).toEqual({
      kind: "runtime-agent-handoff",
      agentId: "finance",
      agentName: "Finance",
      status: "ok",
    });
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
});
