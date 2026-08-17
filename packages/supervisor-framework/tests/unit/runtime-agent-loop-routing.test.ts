import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  routeAfterRuntimeAgentLlm,
  routeAfterRuntimeAgentTools,
} from "../../src/core/agents/build-runtime-agent-nodes.js";
import type { SubAgentState } from "../../src/core/execution/sub-agent-state.js";

const withToolCall = (stepCount: number): SubAgentState => ({
  agentMessages: [
    new HumanMessage("fix today's note"),
    new AIMessage({
      content: "",
      tool_calls: [{
        name: "write_file",
        args: { relativePath: "routine/August/August 17 - Mon.md" },
        id: "write-1",
        type: "tool_call",
      }],
    }),
  ],
  stepCount,
});

const withTextReply = (stepCount: number): SubAgentState => ({
  agentMessages: [
    new HumanMessage("fix today's note"),
    new AIMessage("Updated the note."),
  ],
  stepCount,
});

const withFulfilledTool = (stepCount: number): SubAgentState => ({
  agentMessages: [
    new HumanMessage("fix today's note"),
    new AIMessage({
      content: "",
      tool_calls: [{
        name: "write_file",
        args: { relativePath: "routine/August/August 17 - Mon.md" },
        id: "write-1",
        type: "tool_call",
      }],
    }),
    new ToolMessage({
      tool_call_id: "write-1",
      name: "write_file",
      content: "Success: wrote file.",
    }),
  ],
  stepCount,
});

describe("runtime agent tool-loop routing", () => {
  it("runs a tool call emitted on the last allowed LLM step", () => {
    expect(routeAfterRuntimeAgentLlm(withToolCall(12), "obsidian__tools", "obsidian__finalize"))
      .toBe("obsidian__tools");
  });

  it("finalizes a plain-text reply at max steps", () => {
    expect(routeAfterRuntimeAgentLlm(withTextReply(12), "obsidian__tools", "obsidian__finalize"))
      .toBe("obsidian__finalize");
  });

  it("does not start another LLM turn after tools at max steps", () => {
    expect(routeAfterRuntimeAgentTools(
      withFulfilledTool(12),
      12,
      "obsidian__llm",
      "obsidian__tools",
      "obsidian__finalize",
    )).toBe("obsidian__finalize");
  });

  it("continues the LLM loop after tools when steps remain", () => {
    expect(routeAfterRuntimeAgentTools(
      withFulfilledTool(3),
      12,
      "obsidian__llm",
      "obsidian__tools",
      "obsidian__finalize",
    )).toBe("obsidian__llm");
  });
});
