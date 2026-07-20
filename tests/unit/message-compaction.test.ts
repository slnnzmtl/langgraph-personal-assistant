import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  compactConsumedToolResults,
  compactEmptySubAgentHandoffs,
  formatConsumedHandoffMarker,
  formatConsumedToolMarker,
} from "../../src/core/message-compaction.js";
import {
  createEmptySubAgentHandoffMessage,
  getEmptySubAgentHandoff,
} from "../../src/core/execution/empty-subagent-handoff.js";
import { reduceAgentMessages } from "../../src/core/state.js";

describe("compactConsumedToolResults", () => {
  it("preserves raw tool output while the batch is still active", () => {
    const messages = [
      new HumanMessage("edit note"),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "read_file",
          args: { relativePath: "template.md" },
          id: "read-1",
          type: "tool_call",
        }],
      }),
      new ToolMessage({
        tool_call_id: "read-1",
        name: "read_file",
        content: "# Template\n\nLong setup body that should stay raw for the next turn.",
      }),
    ];

    const compacted = compactConsumedToolResults(messages);

    expect(compacted[2]?.content).toContain("Long setup body");
  });

  it("replaces consumed tool bodies after the next assistant message arrives", () => {
    const readToolResult = new ToolMessage({
      tool_call_id: "read-1",
      name: "read_file",
      content: "# Template\n\nLong setup body.",
    });
    const messages = [
      new HumanMessage("edit note"),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "read_file",
          args: { relativePath: "template.md" },
          id: "read-1",
          type: "tool_call",
        }],
      }),
      readToolResult,
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "write_file",
          args: { relativePath: "note.md" },
          id: "write-1",
          type: "tool_call",
        }],
      }),
    ];

    const compacted = compactConsumedToolResults(messages);

    expect((compacted[2] as ToolMessage).tool_call_id).toBe("read-1");
    expect(compacted[2]?.content).toBe(formatConsumedToolMarker("read_file"));
    expect(compacted[2]?.content).not.toContain("Long setup body");
  });

  it("compacts all completed rounds once a final reply is appended", () => {
    let messages = [
      new HumanMessage("save note"),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "read_file",
          args: {},
          id: "read-1",
          type: "tool_call",
        }],
      }),
      new ToolMessage({
        tool_call_id: "read-1",
        name: "read_file",
        content: "raw read payload",
      }),
      new AIMessage({
        content: "",
        tool_calls: [{
          name: "write_file",
          args: {},
          id: "write-1",
          type: "tool_call",
        }],
      }),
      new ToolMessage({
        tool_call_id: "write-1",
        name: "write_file",
        content: "Success: saved note.",
      }),
    ];

    messages = reduceAgentMessages(messages, new AIMessage("Saved your note."));

    const readResult = messages.find(
      (message) => message instanceof ToolMessage && message.tool_call_id === "read-1",
    ) as ToolMessage | undefined;
    const writeResult = messages.find(
      (message) => message instanceof ToolMessage && message.tool_call_id === "write-1",
    ) as ToolMessage | undefined;

    expect(readResult?.content).toBe(formatConsumedToolMarker("read_file"));
    expect(writeResult?.content).toBe(formatConsumedToolMarker("write_file"));
    expect(messages.at(-1)?.content).toBe("Saved your note.");
  });
});

describe("compactEmptySubAgentHandoffs", () => {
  it("keeps raw toolContext until a resolved supervisor reply is appended", () => {
    const handoff = createEmptySubAgentHandoffMessage(
      [
        new ToolMessage({
          tool_call_id: "sql-1",
          name: "exec_sql",
          content: '{"error":{"message":"bad sql"}}',
        }),
      ],
      "Finance",
    );

    expect(getEmptySubAgentHandoff(handoff)?.toolContext).toContain("bad sql");

    const compacted = compactEmptySubAgentHandoffs([
      new HumanMessage("for yesterday"),
      handoff,
      new AIMessage("The query failed because the table name was wrong."),
    ]);

    const compactedHandoff = getEmptySubAgentHandoff(compacted[1]);
    expect(compactedHandoff?.toolContext).toBe(formatConsumedHandoffMarker("Finance"));
    expect(compactedHandoff?.toolContext).not.toContain("bad sql");
  });

  it("compacts handoff metadata through reduceAgentMessages after supervisor summary", () => {
    const handoff = createEmptySubAgentHandoffMessage(
      [
        new ToolMessage({
          tool_call_id: "sql-1",
          name: "exec_sql",
          content: '{"error":{"message":"relation \\"expenses\\" does not exist"}}',
        }),
      ],
      "Finance",
    );

    const messages = reduceAgentMessages(
      [new HumanMessage("for yesterday only"), handoff],
      new AIMessage("The query failed because the expenses table name was wrong."),
    );

    const compactedHandoff = getEmptySubAgentHandoff(messages[1]);
    expect(compactedHandoff?.toolContext).toBe(formatConsumedHandoffMarker("Finance"));
    expect(messages.at(-1)?.content).toBe("The query failed because the expenses table name was wrong.");
  });
});
