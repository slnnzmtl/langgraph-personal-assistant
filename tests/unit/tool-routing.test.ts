import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  findLastAIMessage,
  hasPendingToolCalls,
  lastMessageRequestsTools,
} from "../../src/nodes/tool-routing.js";

describe("tool-routing", () => {
  it("detects pending tool calls when only part of a batch has responses", () => {
    const messages = [
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "get_categories", args: {}, id: "call-1", type: "tool_call" },
          { name: "fetch_wise_transactions", args: {}, id: "call-2", type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "call-1", content: "[]" }),
    ];

    expect(hasPendingToolCalls(messages)).toBe(true);
    expect(lastMessageRequestsTools(messages)).toBe(false);
  });

  it("returns false once every tool call in the batch has a response", () => {
    const messages = [
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "get_categories", args: {}, id: "call-1", type: "tool_call" },
          { name: "fetch_wise_transactions", args: {}, id: "call-2", type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "call-1", content: "[]" }),
      new ToolMessage({ tool_call_id: "call-2", content: "[]" }),
    ];

    expect(hasPendingToolCalls(messages)).toBe(false);
  });

  it("finds the latest AI message even when tool responses trail it", () => {
    const aiMessage = new AIMessage({
      content: "",
      tool_calls: [{ name: "read_skill", args: {}, id: "call-1", type: "tool_call" }],
    });
    const messages = [
      new HumanMessage("sync finances"),
      aiMessage,
      new ToolMessage({ tool_call_id: "call-1", content: "skill body" }),
    ];

    expect(findLastAIMessage(messages)).toBe(aiMessage);
    expect(hasPendingToolCalls(messages)).toBe(false);
  });

  it("detects when the last message is an AI message requesting tools", () => {
    const messages = [
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: {}, id: "call-1", type: "tool_call" }],
      }),
    ];

    expect(lastMessageRequestsTools(messages)).toBe(true);
    expect(hasPendingToolCalls(messages)).toBe(true);
  });
});
