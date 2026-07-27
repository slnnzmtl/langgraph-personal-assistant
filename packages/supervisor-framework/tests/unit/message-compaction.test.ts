import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  compactConsumedToolResults,
  formatConsumedToolMarker,
} from "../../src/core/message-compaction.js";
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
    let messages: BaseMessage[] = [
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

  it("keeps raw tool bodies when the only follow-up is an empty AI reply", () => {
    const messages = reduceAgentMessages(
      [
        new HumanMessage("show routine"),
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "read_file",
            args: { relativePath: "routine/July/July 24 - Fri.md" },
            id: "read-1",
            type: "tool_call",
          }],
        }),
        new ToolMessage({
          tool_call_id: "read-1",
          name: "read_file",
          content: "## Summary\n- [ ] Gym",
        }),
      ],
      new AIMessage({ content: "" }),
    );

    const readResult = messages.find(
      (message) => message instanceof ToolMessage && message.tool_call_id === "read-1",
    ) as ToolMessage | undefined;

    expect(readResult?.content).toContain("## Summary");
    expect(readResult?.content).not.toBe(formatConsumedToolMarker("read_file"));
  });
});
