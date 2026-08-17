import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";

import { buildDelegationBriefMessages } from "../../src/core/execution/delegation-brief.js";
import {
  DELEGATION_TASK_CONTEXT_KEY,
  PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY,
} from "../../src/core/types/agent.js";

describe("buildDelegationBriefMessages", () => {
  it("returns no messages when context has no brief fields", () => {
    expect(buildDelegationBriefMessages({})).toEqual([]);
    expect(buildDelegationBriefMessages(undefined)).toEqual([]);
  });

  it("builds a brief from task and prior specialist summary", () => {
    const messages = buildDelegationBriefMessages({
      [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: "Synced 5 transactions.",
      [DELEGATION_TASK_CONTEXT_KEY]: "Write a note with those expenses.",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(String(messages[0]?.content)).toBe(
      [
        "Prior specialist result:",
        "Synced 5 transactions.",
        "",
        "Supervisor task:",
        "Write a note with those expenses.",
      ].join("\n"),
    );
  });

  it("omits empty sections", () => {
    const messages = buildDelegationBriefMessages({
      [DELEGATION_TASK_CONTEXT_KEY]: "Show yesterday only.",
    });

    expect(String(messages[0]?.content)).toBe("Supervisor task:\nShow yesterday only.");
  });
});
