import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeAgentPromptMessages,
  isEmptyModelResponse,
  scopeSubAgentMessages,
} from "../../src/core/execution/sub-agent-messages.js";
import { SystemMessage } from "@langchain/core/messages";

describe("scopeSubAgentMessages", () => {
  it("keeps recent human turns so clarification follow-ups retain context", () => {
    const messages = [
      new HumanMessage("Create english learning note and save this link\n\nhttps://example.com/a"),
      new AIMessage("What content should I save?"),
      new HumanMessage("Only the link: https://example.com/a"),
      new AIMessage("I can't open external links."),
      new HumanMessage("DO NOT OPEN JUST SAVE"),
    ];

    expect(scopeSubAgentMessages(messages)).toEqual(messages);
  });

  it("keeps at most the configured number of human turns", () => {
    const messages = [
      new HumanMessage("turn-1"),
      new AIMessage("a1"),
      new HumanMessage("turn-2"),
      new AIMessage("a2"),
      new HumanMessage("turn-3"),
      new AIMessage("a3"),
      new HumanMessage("turn-4"),
    ];

    expect(scopeSubAgentMessages(messages, 2)).toEqual([
      new HumanMessage("turn-3"),
      new AIMessage("a3"),
      new HumanMessage("turn-4"),
    ]);
  });

  it("returns the original list when no human message exists", () => {
    const messages = [new AIMessage("orphan reply")];

    expect(scopeSubAgentMessages(messages)).toEqual(messages);
  });
});

describe("buildRuntimeAgentPromptMessages", () => {
  it("does not merge tool-bearing histories", () => {
    const system = new SystemMessage("system");
    const stateMessages = [
      new HumanMessage("sync"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "1", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "1", content: "skill body" }),
    ];

    const promptMessages = buildRuntimeAgentPromptMessages(system, stateMessages);

    expect(promptMessages).toHaveLength(4);
    expect(promptMessages[1]).toBe(stateMessages[0]);
    expect(promptMessages[2]).toBe(stateMessages[1]);
    expect(promptMessages[3]).toBe(stateMessages[2]);
  });
});

describe("isEmptyModelResponse", () => {
  it("detects empty text and tool-call responses", () => {
    expect(isEmptyModelResponse(new AIMessage(""))).toBe(true);
    expect(isEmptyModelResponse(new AIMessage("done"))).toBe(false);
    expect(isEmptyModelResponse(new AIMessage({
      content: "",
      tool_calls: [{ name: "get_categories", args: {}, id: "1", type: "tool_call" }],
    }))).toBe(false);
  });
});
