import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  getLastHumanText,
  hasVaultMutationSuccessSinceLastHuman,
  isMutationLikeUserMessage,
  resolveObsidianMutationToolPlan,
  resolveObsidianPendingWritePlan,
  resolveObsidianRetryPlan,
} from "../../../src/runtime-agents/policies/obsidian/turn-plan.js";

describe("obsidian turn plan", () => {
  it("detects mutation-like user messages", () => {
    expect(isMutationLikeUserMessage("Buy washing liquid is done")).toBe(true);
    expect(isMutationLikeUserMessage("give me today's plan")).toBe(false);
  });

  it("requires write_file after read_file without a success payload", () => {
    const plan = resolveObsidianPendingWritePlan([
      new HumanMessage("mark buy milk done"),
      new ToolMessage({
        name: "read_file",
        tool_call_id: "read-1",
        content: "- [ ] Buy milk",
      }),
    ]);

    expect(plan?.allowedFunctionNames).toEqual(["write_file"]);
    expect(plan?.nudgeMessage).toMatch(/write_file/i);
  });

  it("requires tools on first mutation turn without tool history", () => {
    const plan = resolveObsidianMutationToolPlan([
      new HumanMessage("Buy washing liquid is done"),
    ]);

    expect(plan?.nudgeMessage).toMatch(/read_file/i);
  });

  it("does not retry after a successful vault write", () => {
    const messages = [
      new HumanMessage("Buy washing liquid is done"),
      new ToolMessage({
        name: "write_file",
        tool_call_id: "write-1",
        content: "Success: Updated routine/July/July 16 - Thu.md",
      }),
    ];

    expect(hasVaultMutationSuccessSinceLastHuman(messages)).toBe(true);
    expect(resolveObsidianRetryPlan(messages, "Updated your plan.")).toBeUndefined();
  });

  it("retries chat-only mutation replies", () => {
    const plan = resolveObsidianRetryPlan(
      [new HumanMessage("Buy washing liquid is done")],
      "Great! I'll mark that as complete.",
    );

    expect(plan?.nudgeMessage).toMatch(/Do not confirm in chat/i);
    expect(getLastHumanText([new HumanMessage("Buy washing liquid is done")])).toBe(
      "Buy washing liquid is done",
    );
  });
});
