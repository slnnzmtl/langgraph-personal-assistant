import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { cleanHistoryForGemini } from "../../src/nodes/message-history.js";

describe("cleanHistoryForGemini", () => {
  it("merges consecutive human and ai turns into a single turn each", () => {
    const original = [
      new HumanMessage("first human"),
      new HumanMessage("second human"),
      new AIMessage("first ai"),
      new AIMessage("second ai"),
    ];

    const cleaned = cleanHistoryForGemini(original);

    expect(cleaned).toHaveLength(2);
    expect(cleaned[0]).toBeInstanceOf(HumanMessage);
    expect(cleaned[0].content).toBe("first human\nsecond human");
    expect(cleaned[1]).toBeInstanceOf(AIMessage);
    expect(cleaned[1].content).toBe("first ai\nsecond ai");
  });

  it("drops tool messages from the Gemini history", () => {
    const cleaned = cleanHistoryForGemini([
      new HumanMessage("first human"),
      new ToolMessage({ tool_call_id: "tool-1", content: "raw tool output" }),
      new AIMessage("first ai"),
    ]);

    expect(cleaned).toHaveLength(2);
    expect(cleaned[0]).toBeInstanceOf(HumanMessage);
    expect(cleaned[1]).toBeInstanceOf(AIMessage);
  });
});