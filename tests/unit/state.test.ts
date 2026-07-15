import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  MESSAGE_HISTORY_LIMIT,
  reduceAgentMessages,
  trimMessagesToLast,
} from "../../src/state.js";

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
      reduceAgentMessages(makeMessages(MESSAGE_HISTORY_LIMIT), toolCallMessage),
      toolResults,
    );

    expect(updated.at(-(toolCalls.length + 1))).toBe(toolCallMessage);
    expect(updated).toHaveLength(toolCalls.length + 1);
  });
});