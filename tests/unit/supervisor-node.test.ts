import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createSupervisorNode } from "../../src/nodes/supervisor-node.js";
import { MESSAGE_HISTORY_LIMIT, trimMessagesToLast } from "../../src/state.js";
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

  it("receives at most the system prompt plus the last 10 state messages", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      expect((input as HumanMessage[])).toHaveLength(MESSAGE_HISTORY_LIMIT + 1);

      return { next: "FINISH", reply: "Trimmed reply" };
    });
    const supervisorNode = createSupervisorNode(connector);
    const history = trimMessagesToLast(
      Array.from({ length: MESSAGE_HISTORY_LIMIT + 4 }, (_, index) =>
        new HumanMessage(`turn-${index + 1}`),
      ),
    );

    const result = await supervisorNode({
      messages: history,
      context: {},
      next: undefined,
    });

    expect(result.next).toBe("FINISH");
    expect(result.messages?.[0]?.content).toBe("Trimmed reply");
  });
});