import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  getRuntimeAgentHandoff,
  RUNTIME_AGENT_HANDOFF_KEY,
} from "../../src/core/execution/runtime-agent-handoff.js";
import { applyRuntimeAgentHandoffToUpdate } from "../../src/core/execution/runtime-agent-handoff.js";

describe("runtime agent handoff protocol", () => {
  it("tags finalized agent replies with structured handoff metadata", () => {
    const update = applyRuntimeAgentHandoffToUpdate(
      { messages: [new AIMessage("Done.")] },
      {
        agentId: "finance",
        agentName: "Finance",
        agentMessages: [new AIMessage("Done.")],
        stepCount: 2,
        maxSteps: 10,
      },
    );

    const handoff = getRuntimeAgentHandoff(update.messages?.[0]);
    expect(handoff).toEqual({
      kind: "runtime-agent-handoff",
      agentId: "finance",
      agentName: "Finance",
      status: "ok",
    });
    expect((update.messages?.[0] as AIMessage).additional_kwargs?.[RUNTIME_AGENT_HANDOFF_KEY]).toBeDefined();
  });
});
