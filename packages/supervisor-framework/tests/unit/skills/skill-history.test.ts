import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { resolveActiveSkillFromHistory } from "../../../src/core/skills/skill-history.js";

describe("resolveActiveSkillFromHistory", () => {
  it("returns the most recent successful read_skill selection", () => {
    const active = resolveActiveSkillFromHistory([
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "cron body" }),
    ]);

    expect(active).toEqual({ skillName: "cron", args: { name: "cron" } });
  });

  it("ignores failed read_skill results", () => {
    const active = resolveActiveSkillFromHistory([
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "Error reading skill" }),
    ]);

    expect(active).toBeUndefined();
  });
});
