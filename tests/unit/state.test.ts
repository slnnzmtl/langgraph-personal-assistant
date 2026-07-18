import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  MESSAGE_HISTORY_LIMIT,
  reduceAgentMessages,
  trimMessagesToLast,
} from "../../src/core/state.js";

const makeMessages = (count: number) =>
  Array.from({ length: count }, (_, index) => new HumanMessage(`message-${index + 1}`));

describe("state message window", () => {
  it("keeps message history intact below the limit", () => {
    const messages = makeMessages(4);

    expect(trimMessagesToLast(messages)).toEqual(messages);
  });

  it("caps message history at the last 10 messages", () => {
    const messages = makeMessages(MESSAGE_HISTORY_LIMIT + 2);
    const trimmed = trimMessagesToLast(messages);

    expect(trimmed).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(trimmed[0]?.content).toBe("message-3");
    expect(trimmed.at(-1)?.content).toBe("message-12");
  });

  it("drops the oldest message when a new one is appended past the boundary", () => {
    const existing = makeMessages(MESSAGE_HISTORY_LIMIT);
    const updated = reduceAgentMessages(existing, new AIMessage("message-11"));

    expect(updated).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(updated[0]?.content).toBe("message-2");
    expect(updated.at(-1)?.content).toBe("message-11");
  });

  it("preserves a complete multi-tool batch when it exceeds the history limit", () => {
    const existing = makeMessages(MESSAGE_HISTORY_LIMIT);
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

  it("preserves the initiating call when the tool batch itself exceeds the limit", () => {
    const priorMessages = makeMessages(MESSAGE_HISTORY_LIMIT);
    const toolCalls = Array.from({ length: MESSAGE_HISTORY_LIMIT + 1 }, (_, index) => ({
      name: "exec_sql",
      args: { sql: `SELECT ${index + 1};` },
      id: `large-tool-${index + 1}`,
      type: "tool_call" as const,
    }));
    const toolCallMessage = new AIMessage({ content: "", tool_calls: toolCalls });
    const toolResults = toolCalls.map(
      (toolCall) => new ToolMessage({ tool_call_id: toolCall.id, content: "ok" }),
    );

    const updated = reduceAgentMessages(
      reduceAgentMessages(priorMessages, toolCallMessage),
      toolResults,
    );

    expect(updated[0]).toBe(priorMessages.at(-1));
    expect(updated.at(-(toolCalls.length + 1))).toBe(toolCallMessage);
    expect(updated).toHaveLength(toolCalls.length + 2);
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
    // Force a cut that would otherwise land on a tool message mid-batch.
    const history = [
      new AIMessage({
        content: "",
        tool_calls: [{ name: "list_files", args: {}, id: "orphan-parent", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "orphan-parent", content: "orphan" }),
      new HumanMessage("keep me"),
      ...Array.from({ length: MESSAGE_HISTORY_LIMIT - 1 }, (_, index) =>
        new AIMessage(`reply-${index + 1}`),
      ),
    ];

    const trimmed = trimMessagesToLast(history);

    expect(trimmed[0]).toBeInstanceOf(HumanMessage);
    expect(trimmed[0]?.content).toBe("keep me");
    expect(trimmed.some((message) => message instanceof ToolMessage && message.tool_call_id === "orphan-parent")).toBe(false);
  });
});