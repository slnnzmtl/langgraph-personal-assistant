import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeAgentHandoff,
  formatRecentToolResultsForHandoff,
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

  it("builds empty handoff state from agent workspace messages", () => {
    const agentMessages = [
      new ToolMessage({
        tool_call_id: "sql-1",
        name: "exec_sql",
        content: "[]",
      }),
    ];

    const handoff = buildRuntimeAgentHandoff({
      agentId: "finance",
      agentName: "Finance",
      message: new AIMessage({ content: "" }),
      agentMessages,
      stepCount: 2,
      maxSteps: 10,
    });

    expect(handoff).toEqual({
      kind: "runtime-agent-handoff",
      agentId: "finance",
      agentName: "Finance",
      status: "empty",
      toolContext: "exec_sql: []",
    });
  });

  it("ignores consumed tool markers when formatting handoff context", () => {
    const context = formatRecentToolResultsForHandoff([
      new ToolMessage({
        tool_call_id: "read-1",
        name: "read_file",
        content: "[consumed: read_file]",
      }),
      new ToolMessage({
        tool_call_id: "read-2",
        name: "read_file",
        content: "## Summary\n- [ ] Gym",
      }),
    ]);

    expect(context).toContain("## Summary");
    expect(context).not.toContain("[consumed:");
  });
});
