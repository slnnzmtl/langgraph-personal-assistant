import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildLatestToolCompletionSummary,
  hasCompletedAgentReply,
  processBlankToolLoopResponse,
} from "../../src/core/execution/tool-completion-summary.js";

describe("tool completion summary", () => {
  it("returns the latest consumable tool body", () => {
    const summary = buildLatestToolCompletionSummary([
      new ToolMessage({ content: "Error: missing", tool_call_id: "1", name: "list_skills" }),
      new ToolMessage({ content: "Agent ID: daily-summary", tool_call_id: "2", name: "list_runtime_agents" }),
    ]);

    expect(summary).toBe("Agent ID: daily-summary");
  });

  it("fills blank model replies from tool output", () => {
    const response = processBlankToolLoopResponse(
      {
        state: {
          agentMessages: [
            new ToolMessage({ content: "Created skill foo", tool_call_id: "1", name: "create_skill" }),
          ],
          stepCount: 1,
        },
      },
      new AIMessage({ content: "" }),
      {
        completionFallback: "Completed.",
        buildSummary: buildLatestToolCompletionSummary,
      },
    );

    expect(response.content).toBe("Created skill foo");
  });

  it("detects completed replies excluding fallback text", () => {
    expect(hasCompletedAgentReply(new AIMessage("Done."), "Completed.")).toBe(true);
    expect(hasCompletedAgentReply(new AIMessage("Completed."), "Completed.")).toBe(false);
  });
});
