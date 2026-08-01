import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  applyDelegationPrompt,
  buildRecoveryPromptMessages,
  buildRuntimeAgentPromptMessages,
  EMPTY_FIRST_TURN_RECOVERY_DIRECTIVE,
  isEmptyModelResponse,
  TOOL_RESULT_RECOVERY_DIRECTIVE,
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

  it("collapses consecutive assistant replies from handoff then FINISH", () => {
    const expenses = "Here are your latest 10 expenses:\n\n* ID: 1725";
    const messages = [
      new HumanMessage("show expenses"),
      new AIMessage(expenses),
      new AIMessage(expenses),
      new HumanMessage("july 30 is missed"),
    ];

    expect(scopeSubAgentMessages(messages)).toEqual([
      new HumanMessage("show expenses"),
      new AIMessage(expenses),
      new HumanMessage("july 30 is missed"),
    ]);
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

  it("removes image parts from older human turns but keeps the latest multimodal human", () => {
    const olderImage = {
      type: "image_url" as const,
      image_url: { url: "data:image/jpeg;base64,old" },
    };
    const latestImage = {
      type: "image_url" as const,
      image_url: { url: "data:image/jpeg;base64,new" },
    };
    const messages = [
      new HumanMessage([
        { type: "text", text: "first screenshot" },
        olderImage,
      ]),
      new AIMessage("Updated note."),
      new HumanMessage([
        { type: "text", text: "second screenshot" },
        latestImage,
      ]),
    ];

    expect(scopeSubAgentMessages(messages)).toEqual([
      new HumanMessage("first screenshot"),
      new AIMessage("Updated note."),
      new HumanMessage([
        { type: "text", text: "second screenshot" },
        latestImage,
      ]),
    ]);
  });
});

describe("applyDelegationPrompt", () => {
  it("replaces the latest human message with the delegated prompt", () => {
    const messages = [
      new HumanMessage("where is the note?"),
      new AIMessage("Checking."),
      new HumanMessage("show me today's plan and yesterday expenses"),
    ];

    const result = applyDelegationPrompt(messages, "Show yesterday's expenses.");

    expect(result).toHaveLength(3);
    expect(String(result[0]?.content)).toBe("where is the note?");
    expect(String(result.at(-1)?.content)).toBe("Show yesterday's expenses.");
  });

  it("prepends a human message when no human message exists", () => {
    const messages = [new AIMessage("orphan reply")];

    const result = applyDelegationPrompt(messages, "Show today's plan.");

    expect(result).toHaveLength(2);
    expect(String(result[0]?.content)).toBe("Show today's plan.");
  });

  it("preserves non-text parts when replacing the latest human message", () => {
    const imagePart = {
      type: "image_url" as const,
      image_url: { url: "data:image/jpeg;base64,ZmFrZQ==" },
    };
    const messages = [
      new HumanMessage("where is the note?"),
      new AIMessage("Checking."),
      new HumanMessage([
        { type: "text", text: "show me today's plan and yesterday expenses" },
        imagePart,
      ]),
    ];

    const result = applyDelegationPrompt(messages, "Show yesterday's expenses.");

    expect(result).toHaveLength(3);
    expect(result.at(-1)?.content).toEqual([
      { type: "text", text: "Show yesterday's expenses." },
      imagePart,
    ]);
  });

  it("keeps prior July context when accepting a sync offer after scope", () => {
    const offer =
      "No matching expenses were found for July 30th. Would you like to sync your transactions?";
    const parentMessages = [
      new HumanMessage("30 july is missed"),
      new AIMessage(offer),
      new AIMessage(offer),
      new HumanMessage("yes"),
    ];

    const result = applyDelegationPrompt(
      scopeSubAgentMessages(parentMessages),
      "Sync transactions.",
    );

    expect(result).toHaveLength(3);
    expect(String(result[0]?.content)).toBe("30 july is missed");
    expect(String(result[1]?.content)).toContain("July 30th");
    expect(String(result[2]?.content)).toBe("Sync transactions.");
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

  it("treats undefined/null content as empty so Gemini empty candidates retry", () => {
    expect(isEmptyModelResponse(new AIMessage({ content: undefined as unknown as string }))).toBe(true);
  });
});

describe("buildRecoveryPromptMessages", () => {
  it("appends a tool-result recovery directive after the normal prompt history", () => {
    const system = new SystemMessage("system");
    const stateMessages = [
      new HumanMessage("uniqlo is clothes"),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "exec_sql",
          args: { sql: "SELECT id FROM public.expense" },
          id: "sql-1",
          type: "tool_call",
        }],
      }),
      new ToolMessage({
        tool_call_id: "sql-1",
        name: "exec_sql",
        content: JSON.stringify({ error: { message: "column reference \"id\" is ambiguous" } }),
      }),
    ];
    const promptMessages = buildRuntimeAgentPromptMessages(system, stateMessages);
    const recoveryMessages = buildRecoveryPromptMessages(promptMessages, {
      isLoopContinuation: true,
    });

    expect(recoveryMessages).toHaveLength(promptMessages.length + 1);
    expect(recoveryMessages.at(-1)).toBeInstanceOf(HumanMessage);
    expect(String(recoveryMessages.at(-1)?.content)).toBe(TOOL_RESULT_RECOVERY_DIRECTIVE);
    expect(String(recoveryMessages.at(-1)?.content)).toContain("ambiguous column");
    expect(String(recoveryMessages.at(-2)?.content)).toContain("ambiguous");
  });

  it("appends a first-turn recovery directive that pushes read_skill or tools", () => {
    const system = new SystemMessage("system");
    const promptMessages = buildRuntimeAgentPromptMessages(
      system,
      [new HumanMessage("list cron jobs")],
    );
    const recoveryMessages = buildRecoveryPromptMessages(promptMessages);

    expect(recoveryMessages).toHaveLength(promptMessages.length + 1);
    expect(String(recoveryMessages.at(-1)?.content)).toBe(EMPTY_FIRST_TURN_RECOVERY_DIRECTIVE);
    expect(String(recoveryMessages.at(-1)?.content)).toContain("read_skill(skill_name)");
  });
});
