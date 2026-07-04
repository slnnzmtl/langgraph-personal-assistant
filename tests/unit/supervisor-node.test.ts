import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createSupervisorNode } from "../../src/nodes/supervisor-node.js";
import { FakeLLMConnector, makeHumanState } from "../helpers/fakes.js";

describe("createSupervisorNode", () => {
  it("appends a direct AI reply for the FINISH path", async () => {
    const connector = new FakeLLMConnector(() => ({
      next: "FINISH",
      reply: "Direct answer",
    }));
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toBe("Direct answer");
  });

  it("returns a route without appending a message for specialized branches", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[]).length).toBeGreaterThan(1);

      return { next: "Finance_SG" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("log lunch expense"));

    expect(result).toEqual({ next: "Finance_SG" });
  });
});