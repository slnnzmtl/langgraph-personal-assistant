import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeAgentPromptMessages,
  isEmptyModelResponse,
  scopeSubAgentMessages,
} from "../../src/core/execution/sub-agent-messages.js";
import { SystemMessage } from "@langchain/core/messages";

describe("scopeSubAgentMessages", () => {
  it("keeps only the latest user turn and later messages", () => {
    const messages = [
      new HumanMessage("today's plan"),
      new AIMessage("Obsidian completed the note."),
      new HumanMessage("list cron jobs"),
      new AIMessage("Here are the cron jobs."),
      new HumanMessage("get yesterday transactions"),
    ];

    expect(scopeSubAgentMessages(messages)).toEqual([
      new HumanMessage("get yesterday transactions"),
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
