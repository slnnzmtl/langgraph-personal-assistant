import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupervisorNode } from "../../src/nodes/supervisor-node.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import { MESSAGE_HISTORY_LIMIT, trimMessagesToLast } from "../../src/state.js";
import { FakeLLMConnector, makeHumanState } from "../helpers/fakes.js";

describe("createSupervisorNode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("Routing rules:");
    expect(prompt).toContain("Use Finance_SG for money, expenses, transactions, budgets, banking, or finance logging.");
    expect(prompt).toContain("Use Obsidian_SG for notes, plans, todos, daily, markdown, writing to a vault, summaries, or documentation.");
    expect(prompt).toContain("Use FINISH for general chat, clarifications, or when you can answer directly without a specialized sub-graph.");
  });

  it("includes the current datetime in the shared system prompt", async () => {
    const currentInstant = new Date("2026-07-05T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];

      expect(promptMessages[0]?.content).toContain("Routing rules:");
      expect(promptMessages[0]?.content).toContain("Current datetime: 2026-07-05T12:34:56.000Z");

      return {
        next: "FINISH",
        reply: "Datetime checked",
      };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(result.messages?.[0]?.content).toBe("Datetime checked");
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
      expect((input as HumanMessage[])).toHaveLength(MESSAGE_HISTORY_LIMIT + 2);
      expect((input as HumanMessage[])[0]?.content).toContain("Routing rules:");
      expect((input as HumanMessage[])[0]?.content).toContain("Use Obsidian_SG for notes, plans, todos, daily, markdown, writing to a vault, summaries, or documentation.");
      expect((input as HumanMessage[]).at(-1)?.content).toContain("Route based primarily on this latest user request:");

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

  it("appends an explicit latest-user routing anchor after the conversation history", async () => {
    const connector = new FakeLLMConnector((input) => {
      expect(Array.isArray(input)).toBe(true);
      const promptMessages = input as HumanMessage[];
      const latestMessage = promptMessages.at(-1);

      expect(latestMessage?.content).toBe(
        "Route based primarily on this latest user request:\ngive me a plan for yesterday",
      );

      return { next: "Obsidian_SG" };
    });
    const supervisorNode = createSupervisorNode(connector);

    const result = await supervisorNode({
      messages: [
        new HumanMessage("where is the note?"),
        new HumanMessage("give me a plan for yesterday"),
      ],
      context: {},
      next: undefined,
    });

    expect(result).toEqual({ next: "Obsidian_SG" });
  });
});