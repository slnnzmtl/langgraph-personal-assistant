import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { createSupervisorNode } from "../../src/nodes/supervisor-node.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import { MESSAGE_HISTORY_LIMIT, trimMessagesToLast } from "../../src/state.js";
import { FakeLLMConnector, makeHumanState } from "../helpers/fakes.js";

describe("createSupervisorNode", () => {
  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("Routing rules:");
    expect(prompt).toContain("Use Finance_SG for money, expenses, transactions, budgets, banking, or finance logging.");
    expect(prompt).toContain("Use Obsidian_SG for notes, plans, todos, daily, markdown, writing to a vault, summaries, or documentation.");
    expect(prompt).toContain("Use FINISH for general chat, clarifications, or when you can answer directly without a specialized sub-graph.");
  });

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
      expect((input as HumanMessage[])[0]?.content).toContain("Routing rules:");
      expect((input as HumanMessage[])[0]?.content).toContain("Use Obsidian_SG for notes, plans, todos, daily, markdown, writing to a vault, summaries, or documentation.");

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