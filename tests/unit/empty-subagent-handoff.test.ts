import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  createEmptySubAgentHandoffMessage,
  formatRecentToolResultsForHandoff,
  getEmptySubAgentHandoff,
} from "../../src/core/execution/runtime-agent-handoff.js";

describe("empty sub-agent handoff", () => {
  it("formats the latest contiguous tool results", () => {
    const context = formatRecentToolResultsForHandoff([
      new HumanMessage("for yesterday"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "exec_sql", args: {}, id: "sql-1", type: "tool_call" }],
      }),
      new ToolMessage({
        tool_call_id: "sql-1",
        name: "exec_sql",
        content: '{"error":{"message":"bad sql"}}',
      }),
    ]);

    expect(context).toContain("exec_sql:");
    expect(context).toContain("bad sql");
  });

  it("round-trips handoff metadata on an empty AI message", () => {
    const handoffMessage = createEmptySubAgentHandoffMessage(
      [
        new ToolMessage({
          tool_call_id: "sql-1",
          name: "exec_sql",
          content: "[]",
        }),
      ],
      "Finance",
    );

    expect(getEmptySubAgentHandoff(handoffMessage)).toEqual({
      agentName: "Finance",
      toolContext: "exec_sql: []",
    });
  });
});
