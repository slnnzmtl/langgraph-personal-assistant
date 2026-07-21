import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  estimateMessageTokens,
  trimMessagesToTokenBudgetSync,
} from "../../src/core/message-trimming.js";
import { reduceAgentMessages } from "../../src/core/state.js";

const makeMessages = (count: number, filler = "") =>
  Array.from({ length: count }, (_, index) => new HumanMessage(`${filler}message-${String(index + 1).padStart(2, "0")}`));

const SMALL_BUDGET = 80;

describe("estimateMessageTokens", () => {
  it("counts short messages proportionally to content length", () => {
    const short = [new HumanMessage("hi")];
    const long = [new HumanMessage("word ".repeat(100))];

    expect(estimateMessageTokens(long)).toBeGreaterThan(estimateMessageTokens(short));
  });

  it("includes tool call overhead for assistant messages", () => {
    const plain = [new AIMessage("done")];
    const withTools = [new AIMessage({
      content: "",
      tool_calls: [{
        name: "exec_sql",
        args: { sql: "SELECT 1;" },
        id: "tool-1",
        type: "tool_call",
      }],
    })];

    expect(estimateMessageTokens(withTools)).toBeGreaterThan(estimateMessageTokens(plain));
  });
});

describe("trimMessagesToTokenBudgetSync", () => {
  it("keeps message history intact below the token budget", () => {
    const messages = makeMessages(4);

    expect(trimMessagesToTokenBudgetSync(messages)).toEqual(messages);
  });

  it("retains more short messages than a fixed count cap would allow", () => {
    const messages = makeMessages(12);
    const trimmed = trimMessagesToTokenBudgetSync(messages);

    expect(trimmed).toHaveLength(12);
    expect(trimmed[0]?.content).toBe("message-01");
    expect(trimmed.at(-1)?.content).toBe("message-12");
  });

  it("drops oldest messages once the token budget is exceeded", () => {
    const messages = makeMessages(12, "word ".repeat(20));
    const trimmed = trimMessagesToTokenBudgetSync(messages, { maxTokens: SMALL_BUDGET });

    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed.at(-1)?.content).toContain("message-12");
    expect(trimmed.some((message) => message.content === "message-01")).toBe(false);
  });

  it("preserves a complete multi-tool batch when it exceeds the token budget", () => {
    const existing = makeMessages(10, "word ".repeat(15));
    const toolCalls = Array.from({ length: 6 }, (_, index) => ({
      name: "exec_sql",
      args: { sql: `SELECT ${index + 1};` },
      id: `tool-${index + 1}`,
      type: "tool_call" as const,
    }));
    const toolCallMessage = new AIMessage({ content: "", tool_calls: toolCalls });
    const toolResults = toolCalls.map(
      (toolCall) => new ToolMessage({
        tool_call_id: toolCall.id,
        content: `result-${toolCall.id}`,
      }),
    );

    const updated = reduceAgentMessages(
      reduceAgentMessages(existing, toolCallMessage),
      toolResults,
    );

    expect(updated.at(-7)).toBe(toolCallMessage);
    expect(updated.slice(-6).map((message) => (message as ToolMessage).tool_call_id)).toEqual(
      toolCalls.map((toolCall) => toolCall.id),
    );
  });

  it("preserves the initiating call when the tool batch itself exceeds the budget", () => {
    const priorMessages = makeMessages(10, "word ".repeat(15));
    const toolCalls = Array.from({ length: 11 }, (_, index) => ({
      name: "exec_sql",
      args: { sql: `SELECT ${index + 1};` },
      id: `large-tool-${index + 1}`,
      type: "tool_call" as const,
    }));
    const toolCallMessage = new AIMessage({ content: "", tool_calls: toolCalls });
    const toolResults = toolCalls.map(
      (toolCall) => new ToolMessage({ tool_call_id: toolCall.id, content: "ok" }),
    );
    const history = [
      ...priorMessages,
      toolCallMessage,
      ...toolResults,
    ];

    const updated = trimMessagesToTokenBudgetSync(history, { maxTokens: 120 });

    expect(updated[0]).toBe(priorMessages.at(-1));
    expect(updated.at(-(toolCalls.length + 1))).toBe(toolCallMessage);
    expect(updated.length).toBeGreaterThan(toolCalls.length);
  });

  it("strips only orphaned leading tool messages after a window cut", () => {
    const history = [
      new AIMessage({
        content: "",
        tool_calls: [{ name: "list_files", args: {}, id: "orphan-parent", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "orphan-parent", content: "orphan" }),
      new HumanMessage("keep me"),
      ...Array.from({ length: 9 }, (_, index) => new AIMessage(`reply-${index + 1}`)),
    ];

    const trimmed = trimMessagesToTokenBudgetSync(history, { maxTokens: SMALL_BUDGET });

    expect(trimmed[0]).toBeInstanceOf(HumanMessage);
    expect(trimmed[0]?.content).toBe("keep me");
    expect(trimmed.some((message) => message instanceof ToolMessage && message.tool_call_id === "orphan-parent")).toBe(false);
  });
});
