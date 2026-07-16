import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import {
  buildSyncExpensesStep1Response,
  recoverEmptySyncExpensesResponse,
  shouldContinueSyncExpensesStep1,
} from "../../../src/runtime-agents/policies/finance/sync-continuation.js";

describe("sync-expenses continuation", () => {
  it("detects when step 1 should run after read_skill", () => {
    const messages = [
      new HumanMessage("get yesterday transactions"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "read-1", content: "skill body" }),
    ];

    expect(shouldContinueSyncExpensesStep1(messages)).toBe(true);
  });

  it("does not continue after step 1 tools already ran", () => {
    const messages = [
      new HumanMessage("get yesterday transactions"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "read-1", content: "skill body" }),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "get_categories", args: {}, id: "cat-1", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "cat-1", content: "[]" }),
    ];

    expect(shouldContinueSyncExpensesStep1(messages)).toBe(false);
  });

  it("builds parallel step 1 tool calls for yesterday requests", () => {
    const now = new Date("2026-07-17T03:01:01.000Z");
    const response = buildSyncExpensesStep1Response(
      [new HumanMessage("get yesterday transactions")],
      now,
    );

    expect(response.tool_calls?.map((call) => call.name)).toEqual([
      "get_categories",
      "fetch_wise_transactions",
    ]);
    expect(response.tool_calls?.[1]?.args).toEqual({
      since: "2026-07-16T00:00:00Z",
      until: "2026-07-16T23:59:59Z",
    });
  });

  it("replaces empty model responses after read_skill", () => {
    const messages = [
      new HumanMessage("get yesterday transactions"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ tool_call_id: "read-1", content: "skill body" }),
    ];

    const recovered = recoverEmptySyncExpensesResponse(new AIMessage(""), messages);

    expect(recovered.tool_calls?.map((call) => call.name)).toEqual([
      "get_categories",
      "fetch_wise_transactions",
    ]);
  });
});
