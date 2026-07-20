import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  estimateMessageTokens,
  trimMessagesToTokenBudgetSync,
} from "../../src/core/message-trimming.js";
import { createReduceAgentMessages, reduceAgentMessages } from "../../src/core/state.js";

const makeMessages = (count: number, filler = "") =>
  Array.from({ length: count }, (_, index) => new HumanMessage(`${filler}message-${String(index + 1).padStart(2, "0")}`));

const SMALL_BUDGET = 80;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("state message window", () => {
  it("keeps message history intact below the token budget", () => {
    const messages = makeMessages(4);

    expect(trimMessagesToTokenBudgetSync(messages)).toEqual(messages);
  });

  it("drops oldest messages when history exceeds the token budget", () => {
    const messages = makeMessages(12, "word ".repeat(20));
    const trimmed = trimMessagesToTokenBudgetSync(messages, { maxTokens: SMALL_BUDGET });

    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed.at(-1)?.content).toContain("message-12");
    expect(trimmed[0]?.content).not.toBe("message-1");
  });

  it("drops the oldest message when a new one is appended past the token budget", () => {
    const existing = makeMessages(10, "word ".repeat(20));
    const updated = reduceAgentMessages(existing, new AIMessage("message-11"));

    expect(updated.length).toBeLessThanOrEqual(existing.length + 1);
    expect(updated.at(-1)?.content).toBe("message-11");
    expect(updated.some((message) => message.content === "message-01")).toBe(false);
  });

  it("uses the configured token budget from createReduceAgentMessages instead of env fallback", () => {
    vi.stubEnv("MESSAGE_HISTORY_MAX_TOKENS", "999999");

    const strictReducer = createReduceAgentMessages(SMALL_BUDGET);
    const existing = makeMessages(10, "word ".repeat(20));
    const updated = strictReducer(existing, new AIMessage("message-11"));

    expect(updated.length).toBeLessThan(existing.length + 1);
    expect(updated.at(-1)?.content).toBe("message-11");
    expect(updated.some((message) => message.content === "message-01")).toBe(false);
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
    expect(updated.slice(-6).map((message) => message.content)).toEqual(
      toolCalls.map((toolCall) => `result-${toolCall.id}`),
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

  it("does not wipe history across many completed tool rounds", () => {
    const userMessage = new HumanMessage("Save to note English learning");
    let messages: ReturnType<typeof reduceAgentMessages> = [userMessage];

    for (let round = 1; round <= 8; round += 1) {
      const toolCallId = `search-${round}`;
      messages = reduceAgentMessages(
        messages,
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "search_files_by_name",
            args: { queries: ["English"] },
            id: toolCallId,
            type: "tool_call",
          }],
        }),
      );
      messages = reduceAgentMessages(
        messages,
        new ToolMessage({
          tool_call_id: toolCallId,
          content: "No files matched your search.",
          name: "search_files_by_name",
        }),
      );
    }

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toBe(userMessage);
    expect(messages.some((message) => message instanceof HumanMessage)).toBe(true);
    expect(messages.at(-1)).toBeInstanceOf(ToolMessage);
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

  it("trims aggressively when a few messages contain massive tool payloads", () => {
    const hugePayload = "x".repeat(8_000);
    const messages = [
      new HumanMessage("old request"),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "exec_sql",
          args: { sql: "SELECT 1;" },
          id: "tool-1",
          type: "tool_call",
        }],
      }),
      new ToolMessage({ tool_call_id: "tool-1", content: hugePayload }),
      new HumanMessage("latest request"),
      new AIMessage("done"),
    ];

    const trimmed = trimMessagesToTokenBudgetSync(messages, { maxTokens: 500 });

    expect(estimateMessageTokens(trimmed)).toBeLessThanOrEqual(500);
    expect(trimmed.some((message) => message.content === "latest request")).toBe(true);
    expect(trimmed.some((message) => message.content === "old request")).toBe(false);
  });
});
